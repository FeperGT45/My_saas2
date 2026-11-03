import { PageTitle } from '@/components/ui/game';
import { LibraryPanel } from '@/features/library/library-panel';
export const metadata = { title: 'Библиотека уроков' };
export default function LibraryPage() {
  return (
    <>
      <PageTitle
        eyebrow="Исследуй английский"
        title="Библиотека уроков"
        description="Практика от первых фраз до точного понимания сложных текстов."
      />
      <LibraryPanel />
    </>
  );
}
