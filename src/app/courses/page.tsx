import { PageTitle } from '@/components/ui/game';
import { LibraryPanel } from '@/features/library/library-panel';
import Link from 'next/link';
export const metadata = { title: 'Курсы · Voklumi' };
export default function CoursesPage() {
  return (
    <>
      <PageTitle
        eyebrow="Выбери направление"
        title="Мир говорит с тобой"
        description="Опубликованные курсы и уроки из библиотеки."
      />
      <LibraryPanel />
      <Link
        href="/library"
        className="text-primary my-3 inline-flex min-h-11 items-center"
      >
        Библиотека уроков из базы
      </Link>
    </>
  );
}
