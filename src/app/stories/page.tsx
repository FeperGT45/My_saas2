import { PageTitle } from '@/components/ui/game';
import { StoriesPanel } from '@/features/stories/stories-panel';
export const metadata = { title: 'Интерактивные истории · Voklumi' };
export default function StoriesPage() {
  return (
    <>
      <PageTitle
        eyebrow="Читай и выбирай"
        title="Интерактивные истории"
        description="Английский, в котором от твоего ответа зависит продолжение."
      />
      <StoriesPanel />
    </>
  );
}
