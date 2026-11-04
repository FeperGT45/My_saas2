import { PageTitle } from '@/components/ui/game';
import { ExtendedPanel } from '@/features/placement/extended-panel';
export const metadata = { title: 'Расширенный тест' };
export default function Page() {
  return (
    <>
      <PageTitle
        title="Английский подробнее"
        description="Расширенная практика оценки уровня · Premium"
      />
      <ExtendedPanel />
    </>
  );
}
