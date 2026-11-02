import { PageTitle } from '@/components/ui/game';
import { SocialPanel } from '@/features/social/social-panel';
export const metadata = { title: 'Друзья' };
export default function FriendsPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твоя команда"
        title="Друзья и приглашения"
        description="Помоги другу сделать первый шаг."
      />
      <SocialPanel friends />
    </>
  );
}
