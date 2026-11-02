import { PageTitle } from '@/components/ui/game';
import { AdminPanel } from '@/features/admin/panel';
import { AdminAccessMessage } from '@/features/admin/access-message';
import { getSessionUser } from '@/lib/auth/session';
import { isAdmin } from '@/lib/admin/access';
export const metadata = {
  title: 'Администрирование',
  robots: { index: false, follow: false },
};
export default async function AdminPage() {
  let owner = '';
  let permitted = false,
    unavailable = false;
  try {
    // A fixed non-loopback origin intentionally prevents the local demo cookie from granting access.
    const user = await getSessionUser(
      new Request('https://voklumi.invalid/admin'),
    );
    permitted = isAdmin(user, process.env.ADMIN_USER_IDS);
    if (permitted && user) owner = user.id;
  } catch {
    unavailable = true;
  }
  return (
    <>
      <PageTitle
        eyebrow="Закрытая зона"
        title="Пульт Voklumi"
        description="Контент, учебная активность и подписки."
      />
      {permitted ? (
        <AdminPanel owner={owner} />
      ) : (
        <AdminAccessMessage unavailable={unavailable} />
      )}
    </>
  );
}
