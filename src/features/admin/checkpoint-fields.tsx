'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdminRow } from './types';
const input =
  'bg-background border-border mt-2 min-h-12 w-full min-w-0 rounded-xl border p-3 text-sm';
export function CheckpointFields({ row }: { row?: AdminRow }) {
  const [questions, setQuestions] = useState(
    () =>
      row?.public_payload?.questions ??
      [1, 2].map((i) => ({
        id: 'q' + i,
        prompt: '',
        options: [
          { id: 'a', label: '' },
          { id: 'b', label: '' },
        ],
      })),
  );
  const [answers, setAnswers] = useState<Record<string, string>>(
    row?.answer_key?.answers ?? { q1: 'a', q2: 'a' },
  );
  const [explanations, setExplanations] = useState<Record<string, string>>(
    row?.answer_key?.explanations ?? {},
  );
  return (
    <fieldset className="space-y-4">
      <legend className="font-bold">Контрольные вопросы</legend>
      <p className="text-muted-foreground text-xs">
        От 2 до 10 вопросов с одним правильным вариантом. Все вопросы блока
        проверяются одним запросом; разбор показывается после проверки.
      </p>
      <input
        type="hidden"
        name="public_payload"
        value={JSON.stringify({ questions })}
      />
      <input
        type="hidden"
        name="answer_key"
        value={JSON.stringify({
          answers: Object.fromEntries(
            questions.map((q) => [q.id, answers[q.id]]),
          ),
          explanations: Object.fromEntries(
            questions.map((q) => [q.id, explanations[q.id]]),
          ),
        })}
      />
      {questions.map((q, index) => (
        <fieldset
          key={q.id}
          className="border-border space-y-3 rounded-2xl border p-3"
        >
          <legend className="px-2 font-semibold">Вопрос {index + 1}</legend>
          <label className="block text-sm">
            Формулировка вопроса {index + 1}
            <textarea
              className={input}
              value={q.prompt}
              onChange={(e) =>
                setQuestions((old) =>
                  old.map((x) =>
                    x.id === q.id ? { ...x, prompt: e.target.value } : x,
                  ),
                )
              }
              maxLength={500}
              required
            />
          </label>
          {q.options.map((o, i) => (
            <div key={o.id}>
              <label className="block text-xs">
                Вариант {index + 1}.{i + 1}
                <input
                  className={input}
                  value={o.label}
                  onChange={(e) =>
                    setQuestions((old) =>
                      old.map((x) =>
                        x.id === q.id
                          ? {
                              ...x,
                              options: x.options.map((v) =>
                                v.id === o.id
                                  ? { ...v, label: e.target.value }
                                  : v,
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                  maxLength={200}
                  required
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-xs">
                <input
                  type="radio"
                  name={`checkpoint-${q.id}`}
                  checked={answers[q.id] === o.id}
                  onChange={() =>
                    setAnswers((old) => ({ ...old, [q.id]: o.id }))
                  }
                />
                Правильный вариант {index + 1}.{i + 1}
              </label>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={q.options.length >= 6}
            onClick={() => {
              const id = crypto.randomUUID();
              setQuestions((old) =>
                old.map((x) =>
                  x.id === q.id
                    ? { ...x, options: [...x.options, { id, label: '' }] }
                    : x,
                ),
              );
            }}
          >
            Добавить вариант к вопросу {index + 1}
          </Button>
          <label className="block text-sm">
            Объяснение вопроса {index + 1}
            <textarea
              className={input}
              value={explanations[q.id] ?? ''}
              onChange={(e) =>
                setExplanations((old) => ({ ...old, [q.id]: e.target.value }))
              }
              maxLength={1000}
              required
            />
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={questions.length <= 2}
            onClick={() =>
              setQuestions((old) => old.filter((x) => x.id !== q.id))
            }
          >
            Убрать вопрос {index + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={questions.length >= 10}
        onClick={() => {
          const id = crypto.randomUUID();
          setQuestions((old) => [
            ...old,
            {
              id,
              prompt: '',
              options: [
                { id: 'a', label: '' },
                { id: 'b', label: '' },
              ],
            },
          ]);
          setAnswers((old) => ({ ...old, [id]: 'a' }));
        }}
      >
        Добавить контрольный вопрос
      </Button>
    </fieldset>
  );
}
