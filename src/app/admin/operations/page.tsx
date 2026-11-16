import { AdminDataBoundary } from '@/features/admin/data-boundary';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { isAdmin } from '@/lib/admin/access';
import { createServiceClient } from '@/lib/supabase/service';
import { Card, PageTitle } from '@/components/ui/game';
import { AdminAccessMessage } from '@/features/admin/access-message';
export const metadata = {
  title: 'Мониторинг',
  robots: { index: false, follow: false },
};
export default async function OperationsPage() {
  let ownerId = '';
  let permitted = false,
    unavailable = false;
  let rows: { code: string; occurrences: number; last_seen_at: string }[] = [];
  let delivered: string | null = null;
  try {
    const user = await getSessionUser(
      new Request('https://voklumi.invalid/admin/operations'),
    );
    permitted = isAdmin(user, process.env.ADMIN_USER_IDS);
    if (permitted && user) {
      ownerId = user.id;
      const db = createServiceClient();
      const [events, notification] = await Promise.all([
        db
          .from('ops_error_counters')
          .select('code,occurrences,last_seen_at')
          .order('last_seen_at', { ascending: false }),
        db
          .from('ops_notification_leases')
          .select('delivered_at')
          .eq('key', 'monitor_ready')
          .maybeSingle(),
      ]);
      if (events.error || notification.error) throw Error();
      rows = events.data;
      delivered = notification.data?.delivered_at ?? null;
    }
  } catch {
    unavailable = true;
  }
  return (
    <>
      <PageTitle
        eyebrow="Закрытая зона"
        title="Мониторинг Voklumi"
        description="Обезличенные счётчики ошибок. Проверки GitHub запускаются примерно каждые 15 минут; время запуска может сдвигаться."
      />
      {!permitted ? (
        <AdminAccessMessage unavailable={unavailable} />
      ) : (
        <AdminDataBoundary owner={ownerId}>
          {unavailable ? (
            <p role="alert">
              Не удалось загрузить мониторинг. Проверь Supabase.
            </p>
          ) : (
            <>
              <Card className="mb-4">
                <p className="font-bold">Уведомления Telegram</p>
                <p className="mt-2 text-sm">
                  {delivered
                    ? 'Первое уведомление доставлено: ' +
                      new Date(delivered).toLocaleString('ru-RU')
                    : 'Первое уведомление пока не подтверждено. Проверь запуск GitHub Actions и бота.'}
                </p>
              </Card>
              {rows.length ? (
                rows.map((row) => (
                  <Card
                    key={row.code}
                    className="mb-3 space-y-2 text-sm break-all"
                  >
                    <p className="font-bold">
                      {(
                        {
                          payment_webhook: 'Подтверждения платежей',
                          telegram_webhook: 'События Telegram',
                          payment_invoice: 'Создание счёта',
                          lesson_api: 'Серверные API обучения',
                          privacy_api: 'Заявки о данных',
                          admin_api: 'Административный API',
                        } as Record<string, string>
                      )[row.code] ?? row.code}
                    </p>
                    <p>Всего ошибок: {String(row.occurrences)}</p>
                    <p>
                      Последняя:{' '}
                      {new Date(row.last_seen_at).toLocaleString('ru-RU')}
                    </p>
                  </Card>
                ))
              ) : (
                <Card>Серверных ошибок пока не зарегистрировано.</Card>
              )}
              <a
                className="text-primary mt-4 flex min-h-12 items-center underline"
                href="https://github.com/FeperGT45/My_saas2/actions/workflows/monitor.yml"
                target="_blank"
                rel="noreferrer"
              >
                Проверки GitHub Actions
              </a>
              <a
                className="text-primary flex min-h-12 items-center underline"
                href="https://github.com/FeperGT45/My_saas2/issues"
                target="_blank"
                rel="noreferrer"
              >
                Резервные уведомления GitHub
              </a>
            </>
          )}
        </AdminDataBoundary>
      )}
      <Link
        href="/admin"
        className="text-primary mt-4 flex min-h-12 items-center"
      >
        ← Администрирование
      </Link>
    </>
  );
}
