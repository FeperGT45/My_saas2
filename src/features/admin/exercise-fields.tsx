'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdminRow, ExerciseKind, Option } from './types';
const input =
  'bg-background border-border w-full min-w-0 rounded-xl border p-3 text-sm';
export const kindLabels: Record<ExerciseKind, string> = {
  single_choice: 'Выбор перевода',
  sentence: 'Предложение из слов',
  gap: 'Пропущенное слово',
  matching: 'Сопоставление слов',
  grammar: 'Грамматическая конструкция',
  listening: 'Аудирование',
};
export function ExerciseFields({
  kind,
  row,
}: {
  kind: ExerciseKind;
  row?: AdminRow;
}) {
  const p = row?.public_payload ?? {},
    a = row?.answer_key ?? {};
  const initial =
    kind === 'sentence' ? p.tokens : kind === 'matching' ? p.left : p.options;
  const [items, setItems] = useState<
    (Option & { order: number; rightId: string; rightLabel: string })[]
  >(() =>
    (
      initial ?? [
        { id: 'o1', label: '' },
        { id: 'o2', label: '' },
      ]
    ).map((x, i) => ({
      ...x,
      order: Array.isArray(a.value) ? a.value.indexOf(x.id) + 1 : i + 1,
      rightId:
        kind === 'matching' ? (a.pairs?.[x.id] ?? `r${i + 1}`) : `r${i + 1}`,
      rightLabel:
        kind === 'matching'
          ? (p.right?.find((r) => r.id === a.pairs?.[x.id])?.label ?? '')
          : '',
    })),
  );
  const [correct, setCorrect] = useState(
    typeof a.value === 'string' ? a.value : (items[0]?.id ?? 'o1'),
  );
  const [sentence, setSentence] = useState(p.sentence ?? '');
  const [accepted, setAccepted] = useState(a.accepted?.join('\n') ?? '');
  const [audio, setAudio] = useState(p.text ?? '');
  const [lang, setLang] = useState(p.lang ?? 'en-US');
  let payload: unknown, key: unknown;
  if (kind === 'gap') {
    payload = { sentence };
    key = {
      accepted: accepted
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  } else if (kind === 'sentence') {
    payload = { tokens: items.map(({ id, label }) => ({ id, label })) };
    key = {
      value: items
        .filter((x) => x.order > 0)
        .sort((x, y) => x.order - y.order)
        .map((x) => x.id),
    };
  } else if (kind === 'matching') {
    payload = {
      left: items.map(({ id, label }) => ({ id, label })),
      right: items
        .map((x) => ({ id: x.rightId, label: x.rightLabel }))
        .reverse(),
    };
    key = { pairs: Object.fromEntries(items.map((x) => [x.id, x.rightId])) };
  } else {
    payload = {
      options: items.map(({ id, label }) => ({ id, label })),
      ...(kind === 'listening' ? { text: audio, lang } : {}),
    };
    key = { value: correct };
  }
  function change(
    i: number,
    field: 'label' | 'order' | 'rightLabel',
    value: string | number,
  ) {
    setItems((old) =>
      old.map((item, j) => (j === i ? { ...item, [field]: value } : item)),
    );
  }
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 font-bold">Содержание задания</legend>
      <input
        type="hidden"
        name="public_payload"
        value={JSON.stringify(payload)}
      />
      <input type="hidden" name="answer_key" value={JSON.stringify(key)} />
      {kind === 'gap' ? (
        <>
          <label className="block text-sm">
            Предложение с пропуском ___
            <input
              className={input}
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              maxLength={500}
              required
            />
          </label>
          <label className="block text-sm">
            Допустимые ответы, каждый с новой строки
            <textarea
              className={input}
              value={accepted}
              onChange={(e) => setAccepted(e.target.value)}
              rows={3}
              required
            />
          </label>
        </>
      ) : (
        <>
          {kind === 'sentence' && (
            <p className="text-muted-foreground text-xs">
              Задай порядок слов в ответе: 1, 2, 3… Для лишнего слова укажи 0.
            </p>
          )}
          {items.map((item, i) => (
            <div
              key={item.id}
              className="border-border space-y-2 rounded-2xl border p-3"
            >
              <label className="block text-xs">
                {kind === 'matching'
                  ? 'Слово'
                  : kind === 'sentence'
                    ? 'Слово'
                    : 'Вариант'}{' '}
                {i + 1}
                <input
                  className={input}
                  value={item.label}
                  onChange={(e) => change(i, 'label', e.target.value)}
                  maxLength={200}
                  required
                />
              </label>
              {kind === 'matching' ? (
                <label className="block text-xs">
                  Перевод {i + 1}
                  <input
                    className={input}
                    value={item.rightLabel}
                    onChange={(e) => change(i, 'rightLabel', e.target.value)}
                    maxLength={200}
                    required
                  />
                </label>
              ) : kind === 'sentence' ? (
                <label className="block text-xs">
                  Порядок слова {i + 1}
                  <input
                    className={input}
                    type="number"
                    min={0}
                    max={30}
                    value={item.order}
                    onChange={(e) => change(i, 'order', Number(e.target.value))}
                    required
                  />
                </label>
              ) : (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="correct-option"
                    checked={correct === item.id}
                    onChange={() => setCorrect(item.id)}
                  />
                  Правильный вариант {i + 1}
                </label>
              )}
              {items.length > 2 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setItems((old) => old.filter((x) => x.id !== item.id));
                    if (correct === item.id)
                      setCorrect(items.find((x) => x.id !== item.id)!.id);
                  }}
                >
                  Убрать элемент {i + 1}
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={items.length >= 30}
            onClick={() => {
              const id = crypto.randomUUID();
              setItems((old) => [
                ...old,
                {
                  id,
                  label: '',
                  order: old.length + 1,
                  rightId: crypto.randomUUID(),
                  rightLabel: '',
                },
              ]);
            }}
          >
            Добавить элемент
          </Button>
        </>
      )}
      {kind === 'listening' && (
        <>
          <label className="block text-sm">
            Текст для озвучивания
            <textarea
              className={input}
              value={audio}
              onChange={(e) => setAudio(e.target.value)}
              maxLength={500}
              required
            />
          </label>
          <label className="block text-sm">
            Язык озвучивания
            <input
              className={input}
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              maxLength={20}
              required
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
