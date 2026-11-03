'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdminRow, ExerciseKind, Option } from './types';
import {
  exerciseLabels,
  orderedKinds,
  openKinds,
} from '@/lib/exercises/contracts';
import { CheckpointFields } from './checkpoint-fields';
const input =
  'bg-background border-border w-full min-w-0 rounded-xl border p-3 text-sm';
export const kindLabels = exerciseLabels;
export function ExerciseFields(props: { kind: ExerciseKind; row?: AdminRow }) {
  return props.kind === 'unit_test' ? (
    <CheckpointFields row={props.row} />
  ) : (
    <RegularExerciseFields {...props} />
  );
}
function RegularExerciseFields({
  kind,
  row,
}: {
  kind: ExerciseKind;
  row?: AdminRow;
}) {
  const p = row?.public_payload ?? {},
    a = row?.answer_key ?? {};
  const initial = orderedKinds.includes(kind)
    ? p.tokens
    : kind === 'matching'
      ? p.left
      : p.options;
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
  const [many, setMany] = useState<string[]>(
    Array.isArray(a.value) ? a.value : [],
  );
  const [context, setContext] = useState(
    p.source ?? p.sentence ?? p.passage ?? p.context ?? p.word ?? p.text ?? '',
  );
  const [lines, setLines] = useState(
    p.lines?.map((l) => `${l.speaker}: ${l.text}`).join('\n') ?? '',
  );
  const [relation, setRelation] = useState(p.relation ?? 'synonym');
  const [sentence, setSentence] = useState(p.sentence ?? '');
  const [accepted, setAccepted] = useState(a.accepted?.join('\n') ?? '');
  const [audio, setAudio] = useState(p.text ?? '');
  const [lang, setLang] = useState(p.lang ?? 'en-US');
  let payload: unknown, key: unknown;
  if (openKinds.includes(kind)) {
    const field =
      kind === 'translation'
        ? 'source'
        : kind === 'correction'
          ? 'sentence'
          : 'text';
    payload = { [field]: context, ...(kind === 'dictation' ? { lang } : {}) };
    key = {
      accepted: accepted
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  } else if (kind === 'gap') {
    payload = { sentence };
    key = {
      accepted: accepted
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  } else if (orderedKinds.includes(kind)) {
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
    payload = {
      ...(payload as object),
      ...(['context_choice', 'error_identification', 'tenses'].includes(kind)
        ? { sentence: context }
        : kind === 'reading'
          ? { passage: context }
          : kind === 'response_choice'
            ? { context }
            : ['synonym_antonym', 'word_review'].includes(kind)
              ? {
                  word: context,
                  ...(kind === 'synonym_antonym' ? { relation } : {}),
                }
              : kind === 'dialogue'
                ? {
                    lines: lines
                      .split('\n')
                      .filter((l) => l.trim())
                      .map((l) => {
                        const split = l.indexOf(':');
                        return {
                          speaker: split < 0 ? '' : l.slice(0, split).trim(),
                          text: split < 0 ? l : l.slice(split + 1).trim(),
                        };
                      }),
                  }
                : {}),
    };
    key = { value: kind === 'multiple_choice' ? many : correct };
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
      {kind === 'gap' || openKinds.includes(kind) ? (
        <>
          <label className="block text-sm">
            {kind === 'gap'
              ? 'Предложение с пропуском ___'
              : kind === 'translation'
                ? 'Исходное предложение для перевода'
                : kind === 'correction'
                  ? 'Предложение с ошибкой'
                  : 'Текст для диктанта'}
            <input
              className={input}
              value={kind === 'gap' ? sentence : context}
              onChange={(e) =>
                kind === 'gap'
                  ? setSentence(e.target.value)
                  : setContext(e.target.value)
              }
              maxLength={kind === 'translation' ? 1000 : 500}
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
          {orderedKinds.includes(kind) && (
            <p className="text-muted-foreground text-xs">
              {kind === 'spelling'
                ? 'Одна английская буква в каждом элементе; задай порядок всех букв.'
                : kind === 'word_order'
                  ? 'Задай порядок всех слов: 1, 2, 3…'
                  : 'Задай порядок слов в ответе: 1, 2, 3… Для лишнего слова укажи 0.'}
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
                  : orderedKinds.includes(kind)
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
              ) : orderedKinds.includes(kind) ? (
                <label className="block text-xs">
                  Порядок слова {i + 1}
                  <input
                    className={input}
                    type="number"
                    min={kind === 'sentence' ? 0 : 1}
                    max={30}
                    value={item.order}
                    onChange={(e) => change(i, 'order', Number(e.target.value))}
                    required
                  />
                </label>
              ) : (
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type={kind === 'multiple_choice' ? 'checkbox' : 'radio'}
                    name="correct-option"
                    checked={
                      kind === 'multiple_choice'
                        ? many.includes(item.id)
                        : correct === item.id
                    }
                    onChange={() =>
                      kind === 'multiple_choice'
                        ? setMany((old) =>
                            old.includes(item.id)
                              ? old.filter((id) => id !== item.id)
                              : [...old, item.id],
                          )
                        : setCorrect(item.id)
                    }
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
                    setMany((old) => old.filter((id) => id !== item.id));
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
      {[
        'error_identification',
        'context_choice',
        'reading',
        'response_choice',
        'tenses',
        'synonym_antonym',
        'word_review',
      ].includes(kind) && (
        <label className="block text-sm">
          {kind === 'reading'
            ? 'Текст для чтения'
            : kind === 'response_choice'
              ? 'Реплика собеседника'
              : kind === 'synonym_antonym' || kind === 'word_review'
                ? 'Слово для изучения'
                : 'Предложение или контекст'}
          <textarea
            className={input}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={
              kind === 'reading'
                ? 5000
                : kind === 'response_choice'
                  ? 1000
                  : kind === 'synonym_antonym' || kind === 'word_review'
                    ? 200
                    : 500
            }
            rows={kind === 'reading' ? 6 : 3}
            required
          />
        </label>
      )}
      {kind === 'dialogue' && (
        <label className="block text-sm">
          Диалог: каждая строка в формате «Имя: реплика»
          <textarea
            className={input}
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            rows={5}
            maxLength={3800}
            required
          />
        </label>
      )}
      {kind === 'synonym_antonym' && (
        <label className="block text-sm">
          Связь слов
          <select
            className={input}
            value={relation}
            onChange={(e) =>
              setRelation(e.target.value as 'synonym' | 'antonym')
            }
          >
            <option value="synonym">Синоним</option>
            <option value="antonym">Антоним</option>
          </select>
        </label>
      )}
      {kind === 'dictation' && (
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
