'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Volume2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Answer, Exercise } from './types';
const subscribeSupport = () => () => {};
export function AudioPrompt({ text, lang }: { text: string; lang: string }) {
  const supported = useSyncExternalStore(
    subscribeSupport,
    () =>
      typeof window !== 'undefined' &&
      typeof window.speechSynthesis?.speak === 'function' &&
      typeof window.SpeechSynthesisUtterance === 'function',
    () => false,
  );
  const [error, setError] = useState(false);
  const [showText, setShowText] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);
  return (
    <div className="border-primary/30 bg-primary/10 mb-4 rounded-2xl border p-4">
      <Button
        variant="outline"
        disabled={!supported || speaking}
        onClick={() => {
          setError(false);
          try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            utterance.rate = 0.85;
            utterance.onend = () => setSpeaking(false);
            utterance.onerror = () => {
              setSpeaking(false);
              setError(true);
            };
            setSpeaking(true);
            window.speechSynthesis.speak(utterance);
          } catch {
            setSpeaking(false);
            setError(true);
          }
        }}
        className="w-full"
      >
        <Volume2 size={18} />
        {speaking ? 'Слушаем…' : 'Прослушать фразу'}
      </Button>
      {speaking && (
        <Button
          variant="outline"
          className="mt-2 w-full"
          onClick={() => {
            window.speechSynthesis.cancel();
            setSpeaking(false);
          }}
        >
          Остановить
        </Button>
      )}
      {supported && (
        <button
          className="text-primary mt-3 min-h-11 text-xs"
          onClick={() => setShowText((v) => !v)}
        >
          {showText ? 'Скрыть текст' : 'Показать текст вместо аудио'}
        </button>
      )}
      {(!supported || error || showText) && (
        <p role="status" className="mt-3 text-sm">
          Текстовый режим: <span lang={lang}>{text}</span>
        </p>
      )}
      <p className="text-muted-foreground mt-2 text-[11px]">
        Озвучка браузера · зависит от доступных голосов устройства
      </p>
    </div>
  );
}
export function ExerciseControls({
  exercise,
  answer,
  onChange,
  disabled,
}: {
  exercise: Exercise;
  answer: Answer;
  onChange: (answer: Answer) => void;
  disabled: boolean;
}) {
  const [left, setLeft] = useState<string | null>(null);
  const p = exercise.payload;
  const array = Array.isArray(answer) ? answer : [];
  const pairs =
    typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
  if (['sentence', 'word_order', 'spelling'].includes(exercise.kind))
    return (
      <div>
        <div
          className="border-primary/30 mb-4 flex min-h-24 flex-wrap items-start gap-2 rounded-2xl border-2 border-dashed p-3"
          role="group"
          aria-label={
            exercise.kind === 'spelling'
              ? 'Собранное слово'
              : 'Собранное предложение'
          }
        >
          {array.length ? (
            array.map((id, i) => (
              <button
                key={id}
                disabled={disabled}
                aria-label={`Убрать ${p.tokens?.find((t) => t.id === id)?.label}`}
                onClick={() =>
                  onChange(array.filter((_, index) => index !== i))
                }
                className="bg-primary text-primary-foreground min-h-11 rounded-xl px-3 text-sm font-bold"
              >
                {p.tokens?.find((t) => t.id === id)?.label}
              </button>
            ))
          ) : (
            <p className="text-muted-foreground self-center text-xs">
              {exercise.kind === 'spelling'
                ? 'Нажимай буквы в нужном порядке'
                : 'Нажимай слова в нужном порядке'}
            </p>
          )}
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={exercise.kind === 'spelling' ? 'Буквы' : 'Слова'}
        >
          {p.tokens?.map((token) => (
            <button
              key={token.id}
              disabled={disabled || array.includes(token.id)}
              onClick={() => onChange([...array, token.id])}
              className="border-border bg-card min-h-12 rounded-xl border-b-4 px-4 text-sm font-semibold disabled:opacity-30"
            >
              {token.label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-4"
          disabled={disabled || !array.length}
          onClick={() => onChange([])}
        >
          <RotateCcw size={16} />
          Очистить
        </Button>
      </div>
    );
  if (exercise.kind === 'gap')
    return (
      <label className="block">
        <span className="bg-card mb-5 block rounded-2xl p-5 text-xl font-bold">
          {p.sentence}
        </span>
        <span className="text-muted-foreground mb-2 block text-xs">
          Пропущенное слово
        </span>
        <input
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={200}
          disabled={disabled}
          value={typeof answer === 'string' ? answer : ''}
          onChange={(e) => onChange(e.target.value)}
          className="border-border bg-card focus:border-primary min-h-14 w-full rounded-2xl border-2 px-4 text-base"
        />
      </label>
    );
  if (exercise.kind === 'matching')
    return (
      <div>
        <p className="text-muted-foreground mb-3 text-xs">
          Выбери слово слева, затем перевод справа. Повторный выбор меняет пару.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2" role="group" aria-label="Слова слева">
            {p.left?.map((item) => (
              <button
                key={item.id}
                disabled={disabled}
                aria-pressed={left === item.id}
                onClick={() => setLeft(item.id)}
                className={cn(
                  'border-border bg-card min-h-16 w-full rounded-2xl border-2 p-3 text-left text-sm font-bold break-words',
                  left === item.id && 'border-primary',
                  pairs[item.id] && 'bg-primary/10',
                )}
              >
                <span>{item.label}</span>
                {pairs[item.id] && (
                  <span className="mt-1 block text-xs font-normal text-teal-200">
                    → {p.right?.find((r) => r.id === pairs[item.id])?.label}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="space-y-2" role="group" aria-label="Переводы справа">
            {p.right?.map((item) => (
              <button
                key={item.id}
                disabled={disabled || !left}
                onClick={() => {
                  const next = { ...pairs };
                  for (const key of Object.keys(next))
                    if (next[key] === item.id) delete next[key];
                  next[left!] = item.id;
                  onChange(next);
                  setLeft(null);
                }}
                className={cn(
                  'border-border bg-card min-h-16 w-full rounded-2xl border-2 p-3 text-left text-sm font-semibold break-words',
                  Object.values(pairs).includes(item.id) &&
                    'border-teal-300/40',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <Button
          variant="outline"
          className="mt-4"
          disabled={disabled || !Object.keys(pairs).length}
          onClick={() => {
            setLeft(null);
            onChange({});
          }}
        >
          Сбросить пары
        </Button>
      </div>
    );
  return (
    <>
      {exercise.kind === 'listening' && (
        <AudioPrompt text={p.text!} lang={p.lang ?? 'en-US'} />
      )}
      <div role="group" aria-label="Варианты ответа" className="grid gap-3">
        {p.options?.map((option, i) => (
          <button
            key={option.id}
            disabled={disabled}
            aria-pressed={answer === option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              'border-border bg-card flex min-h-14 items-center gap-3 rounded-2xl border-2 border-b-4 px-4 py-3 text-left text-sm font-semibold',
              answer === option.id && 'border-primary bg-primary/10',
            )}
          >
            <span className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg border text-xs">
              {i + 1}
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}
export function answerReady(exercise: Exercise, answer: Answer) {
  if (exercise.kind === 'matching')
    return (
      typeof answer === 'object' &&
      !Array.isArray(answer) &&
      Object.keys(answer).length === exercise.payload.left?.length
    );
  if (exercise.kind === 'sentence')
    return Array.isArray(answer) && answer.length > 0;
  return typeof answer === 'string' && answer.trim().length > 0;
}
