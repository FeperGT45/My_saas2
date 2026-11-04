import { PageTitle } from '@/components/ui/game';
import { AppearancePanel } from '@/features/personalization/appearance';
export const metadata = { title: 'Оформление' };
export default function Page() {
  return (
    <>
      <PageTitle title="Твой стиль" description="Выбери настроение Voklumi." />
      <AppearancePanel />
    </>
  );
}
