'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/game';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import { cefrLevels } from '@/lib/placement/types';
import type { LibraryCourse } from '@/lib/library/types';
export function LibraryPanel() {
  const [data, setData] = useState<LibraryCourse[] | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [level, setLevel] = useState('all'),
    [query, setQuery] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetchWithTimeout('/api/library', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await readJson(r);
        if (!r.ok) throw Error(body.error ?? 'Библиотека недоступна.');
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Библиотека недоступна.');
      });
    return () => controller.abort();
  }, [revision]);
  const q = query.trim().toLocaleLowerCase('ru');
  const courses = data
    ?.filter((c) => level === 'all' || c.level === level)
    .map((c) => ({
      ...c,
      lessons: c.lessons.filter(
        (l) =>
          !q ||
          [c.title, l.title, l.description, ...l.objectives]
            .join(' ')
            .toLocaleLowerCase('ru')
            .includes(q),
      ),
    }))
    .filter((c) => c.lessons.length > 0);
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-bold">Уроки из живой библиотеки</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Выбирай подходящие материалы любого уровня. Для личных рекомендаций
          открой учебный план.
        </p>
        <Link
          href="/learning-plan"
          className="text-primary mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-bold"
        >
          Мой учебный план
          <ArrowRight size={16} />
        </Link>
        {data && (
          <p className="mt-3 text-xs text-teal-200">
            Уроков в каталоге: {data.reduce((n, c) => n + c.lessons.length, 0)}{' '}
            · Курсов: {data.length}
          </p>
        )}
      </Card>
      <div className="grid gap-3">
        <label className="text-sm">
          Уровень материалов
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="border-border bg-card mt-2 min-h-12 w-full rounded-xl border px-3"
          >
            <option value="all">Все уровни</option>
            {cefrLevels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Поиск уроков
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Тема, название или цель урока"
            maxLength={100}
            className="border-border bg-card mt-2 min-h-12 w-full rounded-xl border px-3 text-base"
          />
        </label>
      </div>
      {error ? (
        <Card>
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              setError('');
              setData(null);
              setRevision((n) => n + 1);
            }}
          >
            Повторить загрузку библиотеки
          </Button>
        </Card>
      ) : !data ? (
        <Card>
          <p role="status" className="animate-pulse text-sm">
            Загружаем опубликованные уроки…
          </p>
        </Card>
      ) : !courses?.length ? (
        <EmptyState
          icon={<BookOpen />}
          title="Подходящих уроков не найдено"
          text="Выбери другой уровень или измени запрос. Опубликованные материалы сохраняются в библиотеке."
        />
      ) : (
        courses.map((c) => (
          <section key={c.id} className="space-y-3" aria-label={c.title}>
            <div className="pt-4">
              <p className="eyebrow">
                {c.level} ·{' '}
                {c.tier === 'free' ? 'Бесплатный курс' : 'Premium-курс'}
              </p>
              <h2 className="mt-2 text-xl font-bold">{c.title}</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {c.description}
              </p>
            </div>
            {c.lessons.map((l) => (
              <Card key={l.id}>
                <h3 className="font-bold">{l.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm">
                  {l.description || l.unit}
                </p>
                <p className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
                  <BookOpen size={14} />
                  {l.level}
                  {l.minutes && (
                    <>
                      <Clock3 size={14} />
                      Около {l.minutes} мин.
                    </>
                  )}
                </p>
                {!!l.skills.length && (
                  <p className="mt-2 text-xs text-teal-200">
                    {l.skills
                      .map(
                        (s) =>
                          ({
                            grammar: 'Грамматика',
                            vocabulary: 'Словарь',
                            reading: 'Чтение',
                            listening: 'Задания с аудио',
                          })[s] ?? s,
                      )
                      .join(' · ')}
                  </p>
                )}
                {!!(
                  l.objectives.length +
                  l.notes.length +
                  l.prerequisites.length
                ) && (
                  <details className="mt-3">
                    <summary className="text-primary min-h-11 cursor-pointer py-3 text-sm">
                      Цели и пояснения
                    </summary>
                    <ul className="text-muted-foreground space-y-2 text-sm">
                      {l.objectives.map((o) => (
                        <li key={o}>• {o}</li>
                      ))}
                    </ul>
                    {l.notes.map((n) => (
                      <p
                        key={n}
                        className="text-muted-foreground mt-3 text-sm leading-relaxed"
                      >
                        {n}
                      </p>
                    ))}
                    {!!l.prerequisites.length && (
                      <p className="text-muted-foreground mt-3 text-xs">
                        Рекомендуется сначала пройти предыдущие уроки этого
                        курса. Личный план учитывает последовательность; ручной
                        выбор остаётся доступным.
                      </p>
                    )}
                  </details>
                )}
                <Button asChild className="mt-3 w-full">
                  <Link href={`/lesson?lesson=${l.id}`}>
                    {c.tier === 'premium' && !l.preview
                      ? 'Открыть урок Premium'
                      : 'Начать урок'}
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              </Card>
            ))}
          </section>
        ))
      )}
      <p className="text-muted-foreground text-xs leading-relaxed">
        Уровни материалов CEFR ориентировочные. Прохождение этих уроков не
        является сертификацией владения языком.
      </p>
    </div>
  );
}
