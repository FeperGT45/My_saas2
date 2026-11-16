import { AdminDataBoundary } from '@/features/admin/data-boundary';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { isAdmin } from '@/lib/admin/access';
import { createServiceClient } from '@/lib/supabase/service';
import { Card, PageTitle } from '@/components/ui/game';
import { AdminAccessMessage } from '@/features/admin/access-message';
export const metadata = {
  title: 'Заявки о данных',
  robots: { index: false, follow: false },
};
export default async function PrivacyRequestsPage() {
  let ownerId = '';
  let permitted = false,
    unavailable = false;
  let rows: {
    id: string;
    user_id: string;
    status: string;
    created_at: string;
  }[] = [];
  try {
    const user = await getSessionUser(
      new Request('https://voklumi.invalid/admin/privacy'),
    );
    permitted = isAdmin(user, process.env.ADMIN_USER_IDS);
    if (permitted && user) {
      ownerId = user.id;
      const { data, error } = await createServiceClient()
        .from('privacy_deletion_requests')
        .select('id,user_id,status,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw Error();
      rows = data;
    }
  } catch {
    unavailable = true;
  }
  return (
    <>
      <PageTitle
        eyebrow="Закрытая зона"
        title="Заявки об удалении"
        description="Последние 50 заявок. Автоматического удаления данных нет; обработку выполняет владелец после проверки."
      />
      {!permitted ? (
        <AdminAccessMessage unavailable={unavailable} />
      ) : (
        <AdminDataBoundary owner={ownerId}>
          {unavailable ? (
            <p role="alert">Не удалось загрузить заявки. Обнови страницу.</p>
          ) : rows.length ? (
            rows.map((row) => (
              <Card key={row.id} className="mb-3 space-y-2 text-sm break-all">
                <p className="font-bold">Заявка {row.id}</p>
                <p>Пользователь: {row.user_id}</p>
                <p>
                  Статус:{' '}
                  {(
                    {
                      pending: 'Ожидает обработки',
                      processing: 'В обработке',
                      completed: 'Обработана',
                      cancelled: 'Отменена',
                    } as Record<string, string>
                  )[row.status] ?? row.status}
                </p>
                <p>{new Date(row.created_at).toLocaleString('ru-RU')}</p>
              </Card>
            ))
          ) : (
            <Card>Заявок пока нет.</Card>
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
