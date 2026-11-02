'use client';
import { useState } from 'react';
import Link from 'next/link';
import { X, Check, ArrowRight, RotateCcw, Sparkles, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Progress } from '@/components/ui/game';
import { Mascot } from '@/components/ui/mascot';
import { demoQuestions } from '@/features/demo/data';
import { cn } from '@/lib/utils';
export function LessonPlayer() {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [complete, setComplete] = useState(false);
  const question = demoQuestions[index];
  function restart() {
    setIndex(0);
    setSelected(null);
    setChecked(false);
    setScore(0);
    setComplete(false);
  }
  function proceed() {
    if (!checked) {
      if (!selected) return;
      setChecked(true);
      if (selected === question.answer) setScore((s) => s + 1);
    } else if (index === demoQuestions.length - 1) {
      setComplete(true);
    } else {
      setIndex((i) => i + 1);
      setSelected(null);
      setChecked(false);
    }
  }
  if (complete)
    return (
      <div className="text-center">
        <p className="eyebrow">Миссия выполнена</p>
        <Mascot className="mx-auto w-56" />
        <h1 className="text-3xl font-extrabold">Отличный полёт!</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Каждое слово делает твой мир больше.
        </p>
        <Card className="my-6 flex justify-around">
          <div>
            <p className="text-2xl font-black text-teal-300">
              {score} / {demoQuestions.length}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">Верных ответов</p>
          </div>
          <div>
            <p className="text-primary text-2xl font-black">{score * 10} XP</p>
            <p className="text-muted-foreground mt-1 text-xs">Демонстрация</p>
          </div>
        </Card>
        <p className="text-muted-foreground mb-5 text-xs">
          Результат не сохранён и не меняет рейтинг.
        </p>
        <Button asChild className="w-full">
          <Link href="/learn">
            Вернуться на карту
            <ArrowRight size={18} />
          </Link>
        </Button>
        <Button variant="outline" onClick={restart} className="mt-3 w-full">
          <RotateCcw size={16} />
          Ещё один полёт
        </Button>
      </div>
    );
  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/learn"
          aria-label="Выйти из демоурока"
          className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl"
        >
          <X size={20} />
        </Link>
        <Progress
          value={(index / demoQuestions.length) * 100}
          label="Прогресс урока"
          className="flex-1"
        />
        <span className="flex items-center gap-1 text-xs text-pink-300">
          <Heart size={17} fill="currentColor" />∞
        </span>
      </div>
      <p className="eyebrow">
        Первый контакт · {index + 1} из {demoQuestions.length}
      </p>
      <h1 className="mt-3 text-2xl font-extrabold">Найди нужные слова</h1>
      <p className="text-muted-foreground mt-2 text-sm">{question.hint}</p>
      <div className="border-border my-6 flex items-center justify-center gap-2 rounded-3xl border bg-gradient-to-br from-purple-500/10 to-cyan-500/5 p-4">
        <Mascot className="w-24 shrink-0" />
        <p className="border-primary/20 bg-card rounded-2xl rounded-bl-sm border px-5 py-4 text-lg font-bold">
          {question.prompt}
        </p>
      </div>
      <div role="group" aria-label="Варианты ответа" className="grid gap-3">
        {question.options.map((option, i) => (
          <button
            key={option}
            aria-pressed={selected === option}
            disabled={checked}
            onClick={() => setSelected(option)}
            className={cn(
              'border-border bg-card hover:bg-muted flex min-h-14 items-center gap-3 rounded-2xl border-2 border-b-4 px-4 text-left text-sm font-semibold transition-colors',
              selected === option && 'border-primary bg-primary/10',
              checked &&
                option === question.answer &&
                'border-teal-300 bg-teal-300/10',
              checked &&
                selected === option &&
                option !== question.answer &&
                'border-rose-400 bg-rose-400/10',
            )}
          >
            <span className="text-muted-foreground flex size-7 items-center justify-center rounded-lg border border-white/10 text-xs">
              {i + 1}
            </span>
            {option}
            {checked && option === question.answer && (
              <Check size={18} className="ml-auto text-teal-300" />
            )}
          </button>
        ))}
      </div>
      <div aria-live="polite" className="mt-5">
        {checked && (
          <Card
            className={`mb-4 ${selected === question.answer ? 'border-teal-300/30' : 'border-rose-400/30'}`}
          >
            <p
              className={`flex items-center gap-2 text-sm font-bold ${selected === question.answer ? 'text-teal-300' : 'text-rose-300'}`}
            >
              <Sparkles size={16} />
              {selected === question.answer
                ? 'Точно в цель!'
                : 'Новый опыт — тоже прогресс'}
            </p>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {question.explanation}
            </p>
          </Card>
        )}
      </div>
      <Button disabled={!selected} onClick={proceed} className="w-full">
        {checked
          ? index === demoQuestions.length - 1
            ? 'Завершить урок'
            : 'Дальше'
          : 'Проверить'}
        <ArrowRight size={18} />
      </Button>
      <p className="text-muted-foreground mt-4 text-center text-[10px]">
        Учебная демонстрация · без штрафов и сохранения
      </p>
    </>
  );
}
