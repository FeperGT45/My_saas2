'use client';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/game';
import { ExerciseFields, kindLabels } from './exercise-fields';
import type { AdminRow, Entity, ExerciseKind } from './types';
const input =
  'bg-background border-border mt-1 min-h-11 w-full min-w-0 rounded-xl border p-3 text-sm';
const names: Record<Entity, string> = {
  course: 'курс',
  unit: 'раздел',
  lesson: 'урок',
  exercise: 'задание',
};
export function ContentEditor({
  entity,
  row,
  parent,
  languages,
  onSaved,
  onCancel,
}: {
  entity: Entity;
  row?: AdminRow;
  parent?: string;
  languages: AdminRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id] = useState(() => row?.id ?? crypto.randomUUID());
  const [kind, setKind] = useState<ExerciseKind>(row?.kind ?? 'single_choice');
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget),
      str = (k: string) => String(form.get(k) ?? ''),
      num = (k: string) => Number(form.get(k)),
      flag = (k: string) => form.get(k) === 'on';
    const data: Record<string, unknown> = {
      id,
      version: row?.admin_version ?? 0,
    };
    if (entity !== 'exercise') data.title = str('title');
    if (entity === 'course')
      Object.assign(data, {
        language_id: str('language_id'),
        slug: str('slug'),
        level: str('level'),
        published: flag('published'),
        access_tier: str('access_tier'),
      });
    if (entity === 'unit')
      Object.assign(data, { course_id: parent, position: num('position') });
    if (entity === 'lesson')
      Object.assign(data, {
        unit_id: parent,
        position: num('position'),
        xp_reward: num('xp_reward'),
        published: flag('published'),
        free_preview: flag('free_preview'),
      });
    if (entity === 'exercise')
      Object.assign(data, {
        lesson_id: parent,
        position: num('position'),
        kind,
        prompt: str('prompt'),
        explanation: str('explanation'),
        premium_only: flag('premium_only'),
        public_payload: JSON.parse(str('public_payload')),
        answer_key: JSON.parse(str('answer_key')),
      });
    if (
      !window.confirm(
        `Сохранить ${names[entity]} «${data.title ?? data.prompt}»? Изменения публикации и доступа повлияют на новые попытки учеников.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const signature = JSON.stringify(data);
      if (pending.current?.signature !== signature)
        pending.current = { signature, requestId: crypto.randomUUID() };
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: pending.current!.requestId,
          entity,
          data,
          confirmation: `SAVE:${entity}:${id}`,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не удалось сохранить изменения.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2 className="mb-5 text-xl font-bold">
        {row ? 'Редактировать' : 'Создать'} {names[entity]}
      </h2>
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {entity !== 'exercise' && (
            <label className="block text-sm">
              Название
              <input
                className={input}
                name="title"
                defaultValue={row?.title}
                maxLength={160}
                required
              />
            </label>
          )}
          {entity === 'course' && (
            <>
              <label className="block text-sm">
                Язык
                <select
                  className={input}
                  name="language_id"
                  defaultValue={row?.language_id}
                  required
                >
                  {languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Slug курса
                <input
                  className={input}
                  name="slug"
                  defaultValue={row?.slug}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="travel-english"
                  maxLength={100}
                  required
                />
              </label>
              <label className="block text-sm">
                Уровень
                <select
                  className={input}
                  name="level"
                  defaultValue={row?.level ?? 'A1'}
                >
                  {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Доступ
                <select
                  className={input}
                  name="access_tier"
                  defaultValue={row?.access_tier ?? 'free'}
                >
                  <option value="free">Free</option>
                  <option value="premium">Premium</option>
                </select>
              </label>
            </>
          )}
          {entity !== 'course' && (
            <label className="block text-sm">
              Позиция
              <input
                className={input}
                name="position"
                type="number"
                min={1}
                max={10000}
                defaultValue={row?.position ?? 1}
                required
              />
            </label>
          )}
          {entity === 'lesson' && (
            <>
              <label className="block text-sm">
                Награда XP
                <input
                  className={input}
                  name="xp_reward"
                  type="number"
                  min={0}
                  max={1000}
                  defaultValue={row?.xp_reward ?? 10}
                  required
                />
              </label>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="free_preview"
                  defaultChecked={row?.free_preview}
                />
                Бесплатное превью в Premium-курсе
              </label>
            </>
          )}
          {(entity === 'course' || entity === 'lesson') && (
            <>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={row?.published}
                />
                Опубликовано
              </label>
              <p className="text-muted-foreground text-xs">
                Сначала создай черновик, затем задания и уроки. Снятие
                публикации закрывает доступ. Существующие результаты
                сохраняются.
              </p>
            </>
          )}
          {entity === 'exercise' && (
            <>
              <label className="block text-sm">
                Тип задания
                <select
                  className={input}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ExerciseKind)}
                >
                  {Object.entries(kindLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Формулировка
                <textarea
                  className={input}
                  name="prompt"
                  defaultValue={row?.prompt}
                  maxLength={1000}
                  rows={3}
                  required
                />
              </label>
              <ExerciseFields
                key={kind}
                kind={kind}
                row={row?.kind === kind ? row : undefined}
              />
              <label className="block text-sm">
                Объяснение ответа
                <textarea
                  className={input}
                  name="explanation"
                  defaultValue={row?.explanation}
                  maxLength={2000}
                  rows={3}
                  required
                />
              </label>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="premium_only"
                  defaultChecked={row?.premium_only}
                />
                Дополнительное задание Premium
              </label>
            </>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить с подтверждением'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Отмена
          </Button>
        </div>
      </form>
    </Card>
  );
}
