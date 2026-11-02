import { LessonPlayer } from '@/features/lesson/lesson-player';
export const metadata = { title: 'Урок' };
export default async function LessonPage({
  searchParams,
}: {
  searchParams: Promise<{ lesson?: string; attempt?: string }>;
}) {
  const params = await searchParams;
  return (
    <LessonPlayer
      lessonId={typeof params.lesson === 'string' ? params.lesson : undefined}
      initialAttempt={
        typeof params.attempt === 'string' ? params.attempt : undefined
      }
    />
  );
}
