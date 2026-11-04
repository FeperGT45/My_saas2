import { PageTitle } from '@/components/ui/game';
import { DictionaryPanel } from '@/features/learning/dictionary-panel';
export const metadata = { title: 'Мой словарь · Voklumi' };
export default function DictionaryPage() {
  return (
    <>
      <PageTitle
        eyebrow="Твои слова"
        title="Мой словарь"
        description="Свои слова и слова из уроков."
      />
      <DictionaryPanel />
    </>
  );
}
