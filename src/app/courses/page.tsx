import { PageTitle } from '@/components/ui/game';
import { LibraryPanel } from '@/features/library/library-panel';
import Link from 'next/link';
export const metadata = { title: 'Курсы · Voklumi' };
export default function CoursesPage() {
  return (
    <>
      <PageTitle
        eyebrow="Выбери направление"
        title="Все уроки"
        description="Выбери курс по уровню и интересующей теме. A1 — начало, A2 — базовый, B1–B2 — для продолжающих."
      />
      <LibraryPanel />
      <Link
        href="/library"
        className="text-primary my-3 inline-flex min-h-11 items-center"
      >
        Открыть полный каталог
      </Link>
    </>
  );
}
