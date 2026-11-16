import 'server-only';
import { deliverSupport } from '@/lib/support/server';
import { createServiceClient } from '@/lib/supabase/service';
import { telegramCall } from '@/lib/billing/telegram';
import { billingConfiguration } from '@/lib/billing/config';
import { isAdmin } from '@/lib/admin/access';
const descriptions: Record<string, string> = {
  payment_webhook: 'Ошибка обработки платёжного события Telegram.',
  telegram_webhook: 'Ошибка обработки события Telegram.',
  payment_invoice: 'Не удалось создать платёжный счёт.',
  lesson_api: 'Ошибка серверного API обучения.',
  privacy_api: 'Ошибка обработки заявки о данных.',
  admin_api: 'Ошибка административного API.',
};
export async function checkOperations() {
  const db = createServiceClient();
  const checks: Record<string, boolean> = {};
  const [core, schema] = await Promise.all([
    db.rpc('voklumi_database_status').abortSignal(AbortSignal.timeout(5000)),
    db.rpc('privacy_ops_status').abortSignal(AbortSignal.timeout(5000)),
  ]);
  checks.database = !core.error && core.data?.ready === true;
  checks.operations =
    !schema.error &&
    schema.data?.ready === true &&
    schema.data?.version === 'privacy-ops-v3';
  checks.billing = billingConfiguration(process.env).enabled;
  const firstAdmin = process.env.ADMIN_USER_IDS?.split(',')[0]?.trim();
  if (
    !firstAdmin ||
    !isAdmin(
      {
        id: firstAdmin,
        mode: 'telegram',
        name: '',
        avatarUrl: null,
        telegramId: null,
      },
      process.env.ADMIN_USER_IDS,
    )
  )
    throw Error('Alert recipient not configured');
  const { data: owner, error: ownerError } = await db
    .from('users')
    .select('telegram_id')
    .eq('id', firstAdmin)
    .abortSignal(AbortSignal.timeout(3000))
    .maybeSingle();
  if (ownerError || !owner?.telegram_id)
    throw Error('Alert recipient unavailable');
  const notify = async (key: string, text: string, once = false) => {
    const claim = await db
      .rpc('claim_ops_notification', {
        p_key: key,
        p_cooldown: 1800,
        p_once: once,
      })
      .abortSignal(AbortSignal.timeout(3000));
    if (claim.error) throw Error('Notification reservation failed');
    if (!claim.data) {
      const previous = await db
        .from('ops_notification_leases')
        .select('delivered_at')
        .eq('key', key)
        .abortSignal(AbortSignal.timeout(3000))
        .maybeSingle();
      if (previous.error || !previous.data?.delivered_at)
        throw Error('Notification delivery pending or failed');
      return false;
    }
    let delivered = false;
    try {
      await telegramCall(
        'sendMessage',
        {
          chat_id: owner.telegram_id,
          text: `Voklumi · мониторинг\n${text}\n${new Date().toISOString()}\nПанель: ${new URL('/admin', process.env.APP_URL).href}`,
          disable_web_page_preview: true,
        },
        4000,
      );
      delivered = true;
    } finally {
      const saved = await db
        .rpc('complete_ops_notification', {
          p_key: key,
          p_lease: claim.data,
          p_delivered: delivered,
        })
        .abortSignal(AbortSignal.timeout(3000));
      if (saved.error || !delivered)
        throw Error('Notification delivery failed');
    }
    return true;
  };
  try {
    const raw = await telegramCall('getWebhookInfo', {}, 4000);
    const webhook = raw as {
      url: string;
      allowed_updates?: string[];
      last_error_date?: number;
    };
    checks.webhook =
      webhook.url ===
        new URL('/api/telegram/webhook', process.env.APP_URL).href &&
      ['message', 'pre_checkout_query', 'callback_query'].every((t) =>
        webhook.allowed_updates?.includes(t),
      ) &&
      !(
        webhook.last_error_date &&
        webhook.last_error_date > Date.now() / 1000 - 1800
      );
  } catch {
    checks.webhook = false;
  }
  try {
    await deliverSupport(null, 10);
    checks.support = true;
  } catch {
    checks.support = false;
  }
  const [events, requests] = await Promise.all([
    db
      .from('ops_error_counters')
      .select('code,occurrences,notified_occurrences,last_seen_at')

      .abortSignal(AbortSignal.timeout(3000)),
    db
      .from('privacy_deletion_requests')
      .select('id,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000)),
  ]);
  if (events.error || requests.error)
    throw Error('Monitoring journal unavailable');
  const alerts: string[] = [];
  for (const [code, healthy] of Object.entries(checks))
    if (!healthy) alerts.push(`Проверка «${code}» не прошла.`);
  const pendingEvents = (events.data ?? []).filter(
    (event) => Number(event.occurrences) > Number(event.notified_occurrences),
  );
  for (const event of pendingEvents)
    alerts.push(
      `${descriptions[event.code] ?? 'Серверная ошибка'} Всего: ${event.occurrences}. Последняя: ${event.last_seen_at}.`,
    );
  if (alerts.length && (await notify('ops_digest', alerts.join('\n')))) {
    for (const event of pendingEvents) {
      const ack = await db
        .from('ops_error_counters')
        .update({ notified_occurrences: event.occurrences })
        .eq('code', event.code)
        .abortSignal(AbortSignal.timeout(3000));
      if (ack.error) throw Error('Notification acknowledgement failed');
    }
  }
  if (requests.data?.length) {
    const { data: last } = await db
      .from('ops_notification_leases')
      .select('delivered_at')
      .eq('key', 'privacy_requests')
      .maybeSingle();
    if (
      !last?.delivered_at ||
      Date.parse(requests.data[0].created_at) > Date.parse(last.delivered_at)
    )
      await notify(
        'privacy_requests',
        'Есть новая заявка на удаление аккаунта. Проверь закрытую панель заявок.',
      );
  }
  if (Object.values(checks).every(Boolean))
    await notify(
      'monitor_ready',
      'Внешние проверки запущены. База, платежи и конфигурация webhook доступны. Ошибки будут приходить сюда; при недоступности приложения сработает резервное уведомление GitHub.',
      true,
    );
  return {
    status: Object.values(checks).every(Boolean) ? 'ok' : 'unavailable',
    checks,
  };
}
