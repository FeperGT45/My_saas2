import type { AdminView, Entity, ExerciseKind } from '@/features/admin/types';
import { exerciseKinds } from '@/lib/exercises/contracts';
import { validateExtendedExercise } from '@/lib/exercises/authoring';
export class AdminValidationError extends Error {}
function fail(message: string): never {
  throw new AdminValidationError(message);
}
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    fail('Ожидается объект данных.');
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(v).some((k) => !allowed.includes(k)))
    fail('В запросе есть неподдерживаемые поля.');
}
function text(v: unknown, label: string, max = 160): string {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    fail(`${label}: укажи текст длиной от 1 до ${max} символов.`);
  return v.trim();
}
function integer(v: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(v) || Number(v) < min || Number(v) > max)
    fail(`${label}: требуется целое число от ${min} до ${max}.`);
  return Number(v);
}
function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') fail('Укажи логическое значение.');
  return v as boolean;
}
function id(v: unknown): string {
  if (!uuid(v)) fail('Некорректный идентификатор.');
  return v as string;
}
function oneOf<T extends string>(v: unknown, values: readonly T[]): T {
  if (!values.includes(v as T)) fail('Недопустимое значение поля.');
  return v as T;
}
function options(v: unknown) {
  if (!Array.isArray(v) || v.length < 2 || v.length > 30)
    fail('Нужно от 2 до 30 элементов.');
  const result = (v as unknown[]).map((x) => {
    const o = object(x);
    keys(o, ['id', 'label']);
    const key = text(o.id, 'ID элемента', 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) fail('Некорректный ID элемента.');
    return { id: key, label: text(o.label, 'Текст элемента', 200) };
  });
  if (new Set(result.map((x) => x.id)).size !== result.length)
    fail('ID элементов должны быть уникальны.');
  return result;
}
export function validateExercise(
  kind: ExerciseKind,
  payload: unknown,
  answer: unknown,
) {
  try {
    const extended = validateExtendedExercise(kind, payload, answer);
    if (extended) return extended;
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Некорректное задание.');
  }
  const p = object(payload),
    a = object(answer);
  if (['single_choice', 'grammar', 'listening'].includes(kind)) {
    keys(p, kind === 'listening' ? ['options', 'text', 'lang'] : ['options']);
    keys(a, ['value']);
    const opts = options(p.options);
    const value = text(a.value, 'Правильный ответ', 64);
    if (!opts.some((o) => o.id === value))
      fail('Выбери правильный вариант из списка.');
    if (kind === 'listening') {
      const lang = text(p.lang, 'Язык аудио', 20);
      if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang))
        fail('Язык аудио: например en-US.');
      return {
        public_payload: {
          options: opts,
          text: text(p.text, 'Текст аудио', 500),
          lang,
        },
        answer_key: { value },
      };
    }
    return { public_payload: { options: opts }, answer_key: { value } };
  }
  if (kind === 'sentence') {
    keys(p, ['tokens']);
    keys(a, ['value']);
    const tokens = options(p.tokens);
    if (
      !Array.isArray(a.value) ||
      !a.value.length ||
      a.value.length > tokens.length ||
      new Set(a.value).size !== a.value.length ||
      a.value.some((v) => !tokens.some((t) => t.id === v))
    )
      fail('Задай последовательность слов без повторения ID.');
    return {
      public_payload: { tokens },
      answer_key: { value: a.value as string[] },
    };
  }
  if (kind === 'gap') {
    keys(p, ['sentence']);
    keys(a, ['accepted']);
    const sentence = text(p.sentence, 'Предложение', 500);
    if (!sentence.includes('___')) fail('Обозначь пропуск символами ___.');
    if (
      !Array.isArray(a.accepted) ||
      a.accepted.length < 1 ||
      a.accepted.length > 20
    )
      fail('Укажи от 1 до 20 допустимых ответов.');
    const accepted = a.accepted.map((v) => text(v, 'Допустимый ответ', 150));
    return { public_payload: { sentence }, answer_key: { accepted } };
  }
  keys(p, ['left', 'right']);
  keys(a, ['pairs']);
  const left = options(p.left),
    right = options(p.right),
    pairs = object(a.pairs);
  if (
    left.length !== right.length ||
    Object.keys(pairs).length !== left.length ||
    new Set(Object.values(pairs)).size !== right.length ||
    left.some((l) => !right.some((r) => r.id === pairs[l.id]))
  )
    fail('Каждому слову нужна ровно одна уникальная пара.');
  return {
    public_payload: { left, right },
    answer_key: { pairs: pairs as Record<string, string> },
  };
}
const views: AdminView[] = [
  'overview',
  'users',
  'courses',
  'units',
  'lessons',
  'exercises',
  'languages',
  'activity',
  'subscriptions',
  'audit',
];
export function parseAdminQuery(url: string) {
  const q = new URL(url).searchParams;
  if (
    [...q.keys()].some(
      (k) => !['view', 'parent', 'search', 'offset'].includes(k),
    ) ||
    [...q.keys()].some((k) => q.getAll(k).length !== 1)
  )
    fail('Некорректные параметры списка.');
  const view = oneOf(q.get('view') ?? 'overview', views),
    parent = q.get('parent');
  if (['units', 'lessons', 'exercises'].includes(view) && !parent)
    fail('Сначала выбери родительский раздел.');
  if (parent && !uuid(parent)) fail('Некорректный идентификатор раздела.');
  const raw = q.get('offset') ?? '0';
  if (!/^\d{1,7}$/.test(raw)) fail('Некорректная страница.');
  const offset = integer(Number(raw), 'Страница', 0, 1000000);
  const search = q.get('search')?.trim() ?? '';
  if (search.length > 80) fail('Поиск: максимум 80 символов.');
  return { view, parent, search, offset };
}
export type AdminCommand = ReturnType<typeof parseAdminCommand>;
export function parseAdminCommand(value: unknown) {
  const b = object(value);
  keys(b, ['requestId', 'entity', 'data', 'confirmation']);
  const requestId = id(b.requestId),
    entity = oneOf<Entity>(b.entity, ['course', 'unit', 'lesson', 'exercise']);
  const d = object(b.data),
    data: Record<string, unknown> = {
      id: id(d.id),
      version: integer(d.version, 'Версия', 0, 2147483646),
    };
  if (b.confirmation !== `SAVE:${entity}:${data.id}`)
    fail('Подтверди сохранение изменений.');
  if (entity === 'course') {
    keys(d, [
      'id',
      'version',
      'language_id',
      'slug',
      'title',
      'level',
      'published',
      'access_tier',
    ]);
    Object.assign(data, {
      language_id: id(d.language_id),
      slug: text(d.slug, 'Slug', 100),
      title: text(d.title, 'Название'),
      level: oneOf(d.level, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
      published: bool(d.published),
      access_tier: oneOf(d.access_tier, ['free', 'premium']),
    });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug as string))
      fail('Slug: латинские буквы, цифры и дефисы.');
  }
  if (entity === 'unit') {
    keys(d, ['id', 'version', 'course_id', 'title', 'position']);
    Object.assign(data, {
      course_id: id(d.course_id),
      title: text(d.title, 'Название'),
      position: integer(d.position, 'Позиция', 1, 10000),
    });
  }
  if (entity === 'lesson') {
    keys(d, [
      'id',
      'version',
      'unit_id',
      'title',
      'position',
      'xp_reward',
      'published',
      'free_preview',
    ]);
    Object.assign(data, {
      unit_id: id(d.unit_id),
      title: text(d.title, 'Название'),
      position: integer(d.position, 'Позиция', 1, 10000),
      xp_reward: integer(d.xp_reward, 'XP', 0, 1000),
      published: bool(d.published),
      free_preview: bool(d.free_preview),
    });
  }
  if (entity === 'exercise') {
    keys(d, [
      'id',
      'version',
      'lesson_id',
      'position',
      'kind',
      'prompt',
      'explanation',
      'premium_only',
      'public_payload',
      'answer_key',
    ]);
    const kind = oneOf<ExerciseKind>(d.kind, exerciseKinds);
    Object.assign(data, {
      lesson_id: id(d.lesson_id),
      position: integer(d.position, 'Позиция', 1, 10000),
      kind,
      prompt: text(d.prompt, 'Задание', 1000),
      explanation: text(d.explanation, 'Объяснение', 2000),
      premium_only: bool(d.premium_only),
      ...validateExercise(kind, d.public_payload, d.answer_key),
    });
  }
  return { requestId, entity, data, confirmation: b.confirmation as string };
}
