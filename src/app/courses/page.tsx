'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight, BookOpen } from 'lucide-react';
import { PageTitle, Card, Progress, EmptyState } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { demoCourses } from '@/features/demo/data';
export default function CoursesPage() {
  const [query, setQuery] = useState('');
  const courses = demoCourses.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase().trim()),
  );
  return (
    <>
      <PageTitle
        eyebrow="Выбери направление"
        title="Мир говорит с тобой"
        description="А ты на каком языке ответишь?"
      />
      <Button asChild className="mb-5 w-full">
        <Link href="/library">
          <BookOpen size={18} />
          Библиотека уроков из базы
          <ArrowRight size={16} />
        </Link>
      </Button>
      <label className="border-border bg-card text-muted-foreground mb-6 flex items-center gap-3 rounded-2xl border px-4">
        <Search size={18} />
        <input
          aria-label="Поиск курсов"
          placeholder="Найти свой язык"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <div className="space-y-4">
        {courses.map((course) => (
          <Card key={course.id} className="relative overflow-hidden">
            <div
              className={`absolute -top-10 -right-10 size-32 rounded-full blur-3xl ${course.color === 'purple' ? 'bg-purple-500/15' : course.color === 'teal' ? 'bg-teal-500/15' : 'bg-blue-500/15'}`}
            />
            <div className="relative flex items-center justify-between">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-white/5 text-3xl">
                {course.flag}
              </span>
              <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-[10px]">
                {course.available ? 'В процессе' : 'Скоро'}
              </span>
            </div>
            <h2 className="mt-4 text-xl font-bold">{course.name}</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {course.subtitle}
            </p>
            <p className="text-muted-foreground my-4 text-[11px]">
              {course.level} <span className="mx-2">✦</span> {course.lessons}{' '}
              уроков
            </p>
            {course.available ? (
              <>
                <div className="mb-2 flex justify-between text-[11px]">
                  <span>Твой прогресс</span>
                  <span className="text-primary">{course.progress}%</span>
                </div>
                <Progress
                  value={course.progress}
                  label={`Курс ${course.name}`}
                />
                <Button asChild className="mt-5 w-full">
                  <Link href="/learn">
                    Продолжить путь
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              </>
            ) : (
              <Button disabled variant="outline" className="w-full">
                Готовим к запуску
              </Button>
            )}
          </Card>
        ))}
      </div>
      {!courses.length && (
        <EmptyState
          icon={<BookOpen />}
          title="Такого курса пока нет"
          text="Попробуй другое название языка."
        />
      )}
    </>
  );
}
