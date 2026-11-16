import 'server-only';
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { isAdmin } from '@/lib/admin/access';
import { telegramCall } from '@/lib/billing/telegram';
import { supportInput } from './input';

async function staffChats() {
  const ids = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((v) => v.trim());
  if (
    !ids.length ||
    !ids.every((id) =>
      isAdmin(
        { id, mode: 'telegram', name: '', avatarUrl: null, telegramId: null },
        process.env.ADMIN_USER_IDS,
      ),
    )
  )
    throw Error('Support administrators not configured');
  const { data, error } = await createServiceClient()
    .from('users')
    .select('telegram_id')
    .in('id', ids)
    .abortSignal(AbortSignal.timeout(4000));
  if (error) throw Error('Support administrators unavailable');
  const chats = [
    ...new Set(
      (data ?? [])
        .map((row) => Number(row.telegram_id))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
  if (!chats.length) throw Error('Support administrators unavailable');
  return chats;
}

/** Durable outbox. Telegram itself has no idempotency key for sendMessage: a lost
 * HTTP response can cause a repeated notification, but never a second ticket/message. */
export async function deliverSupport(update: number | null = null, limit = 12) {
  const db = createServiceClient();
  const staff = await staffChats();
  let failed = false;
  for (let i = 0; i < limit; i++) {
    const claim = await db
      .rpc('claim_support_delivery', { p_update: update })
      .abortSignal(AbortSignal.timeout(4000));
    if (claim.error) throw Error('Support delivery unavailable');
    const job = claim.data?.[0];
    if (!job) break;
    let sent = false;
    try {
      // A removed administrator must never receive a previously queued private message.
      if (!job.staff_only || staff.includes(Number(job.chat_id)))
        await telegramCall(
          'sendMessage',
          {
            chat_id: job.chat_id,
            text: job.body,
            disable_web_page_preview: true,
          },
          4000,
        );
      sent = true;
    } catch {
      failed = true;
    } finally {
      const saved = await db
        .rpc('complete_support_delivery', {
          p_id: job.id,
          p_lease: job.lease,
          p_sent: sent,
        })
        .abortSignal(AbortSignal.timeout(4000));
      if (saved.error) throw Error('Support delivery pending');
    }
  }
  if (failed) throw Error('Support delivery pending');
}
export async function handleSupportWebhook(update: unknown) {
  const input = supportInput(
    update,
    process.env.TELEGRAM_BOT_USERNAME ?? 'Voklumi_bot',
  );
  if (!input) return false;
  if (input.callbackId) {
    try {
      await telegramCall('answerCallbackQuery', {
        callback_query_id: input.callbackId,
      });
    } catch {
      // An expired callback acknowledgment must not prevent a persisted ticket.
    }
  }
  const staff = await staffChats();
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        actor: input.actor,
        action: input.action,
        text: input.text,
        ticket: input.ticket,
      }),
    )
    .digest('hex');
  const { data, error } = await createServiceClient()
    .rpc('process_support_update', {
      p_update: input.update,
      p_actor: input.actor,
      p_fingerprint: fingerprint,
      p_action: input.action,
      p_text: input.text,
      p_ticket: input.ticket,
      p_admin: staff.includes(input.actor),
      p_admin_chats: staff,
    })
    .abortSignal(AbortSignal.timeout(5000));
  if (error) throw Error('Support request unavailable');
  if (data) await deliverSupport(input.update);
  return data === true;
}
