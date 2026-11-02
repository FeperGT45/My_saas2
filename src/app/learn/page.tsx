import type { Metadata } from 'next';
import { BookOpen, LockKeyhole } from 'lucide-react';
import { learningPaths } from '@/features/learning/data';
export const metadata: Metadata = { title: 'Обучение' };
export default function LearnPage() {
  return (
    <>
      <p className="text-primary text-sm">Английский язык</p>
      <h1 className="mt-2 text-3xl font-bold">Твой маршрут</h1>
      <p className="text-muted-foreground mt-3 text-sm">
        От первых слов к уверенным разговорам.
      </p>
      <div className="mt-7 space-y-3">
        {learningPaths.map((path, i) => (
          <article
            key={path.title}
            className="border-border bg-card rounded-2xl border p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-primary flex items-center gap-2 text-xs">
                <BookOpen size={16} />
                Модуль {i + 1} · {path.level}
              </span>
              <LockKeyhole
                size={16}
                className="text-muted-foreground"
                aria-label="Скоро"
              />
            </div>
            <h2 className="mt-4 text-lg font-bold">{path.title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {path.description}
            </p>
            <p className="text-muted-foreground mt-4 text-xs">
              {path.lessons} уроков · Скоро
            </p>
          </article>
        ))}
      </div>
      <p className="text-muted-foreground mt-5 text-xs">
        Пример структуры курса. Прохождение уроков пока недоступно.
      </p>
    </>
  );
}
