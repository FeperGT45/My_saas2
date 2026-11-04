import Link from 'next/link';
import { ReviewPanel } from '@/features/review/review-panel';
export const metadata = { title: 'Повторение слов · Voklumi' };
export default function ReviewPage() {
  return (
    <>
      <Link
        href="/dictionary"
        className="text-primary mb-4 flex min-h-12 items-center rounded-2xl border p-4 text-sm font-bold"
      >
        Мой словарь и слова из уроков →
      </Link>
      <ReviewPanel />
    </>
  );
}
