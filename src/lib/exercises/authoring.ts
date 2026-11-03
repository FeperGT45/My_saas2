import {
  choiceKinds,
  orderedKinds,
  openKinds,
  type ExerciseKind,
  type ExercisePayload,
  type ExerciseKey,
} from './contracts';
function fail(message: string): never {
  throw new Error(message);
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail('Ожидается объект задания.');
function keys(v: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(v).some((k) => !allowed.includes(k)))
    fail('В задании есть неподдерживаемые поля.');
}
function text(v: unknown, max = 1000): string {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    fail('Проверь длину и содержание текста задания.');
  return v.trim();
}
function id(v: unknown) {
  const s = text(v, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) fail('Некорректный ID элемента.');
  return s;
}
function items(v: unknown) {
  if (!Array.isArray(v) || v.length < 2 || v.length > 30)
    fail('Нужно от 2 до 30 элементов.');
  const result = (v as unknown[]).map((x) => {
    const o = obj(x);
    keys(o, ['id', 'label']);
    return { id: id(o.id), label: text(o.label, 200) };
  });
  if (new Set(result.map((x) => x.id)).size !== result.length)
    fail('ID элементов должны быть уникальны.');
  return result;
}
export function validateExtendedExercise(
  kind: ExerciseKind,
  payload: unknown,
  key: unknown,
): { public_payload: ExercisePayload; answer_key: ExerciseKey } | undefined {
  if (
    [
      'single_choice',
      'sentence',
      'gap',
      'matching',
      'grammar',
      'listening',
    ].includes(kind)
  )
    return undefined;
  const p = obj(payload),
    a = obj(key);
  if (openKinds.includes(kind)) {
    const field =
      kind === 'translation'
        ? 'source'
        : kind === 'correction'
          ? 'sentence'
          : 'text';
    keys(p, kind === 'dictation' ? [field, 'lang'] : [field]);
    keys(a, ['accepted']);
    if (
      !Array.isArray(a.accepted) ||
      !a.accepted.length ||
      a.accepted.length > 20
    )
      fail('Укажи от 1 до 20 допустимых формулировок.');
    const result: ExercisePayload = {
      [field]: text(p[field], kind === 'translation' ? 1000 : 500),
    };
    if (kind === 'dictation') {
      const lang = p.lang ?? 'en-US';
      if (typeof lang !== 'string' || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(lang))
        fail('Язык аудио: например en-US.');
      result.lang = lang;
    }
    return {
      public_payload: result,
      answer_key: {
        accepted: (a.accepted as unknown[]).map((v) => text(v, 1000)),
      },
    };
  }
  if (orderedKinds.includes(kind) || kind === 'multiple_choice') {
    const field = kind === 'multiple_choice' ? 'options' : 'tokens';
    keys(p, [field]);
    keys(a, ['value']);
    const opts = items(p[field]);
    if (
      !Array.isArray(a.value) ||
      !a.value.length ||
      new Set(a.value).size !== a.value.length ||
      a.value.some((v) => !opts.some((o) => o.id === v))
    )
      fail('Задай правильную последовательность или набор без повторения ID.');
    if (kind === 'multiple_choice' && a.value.length < 2)
      fail('Выбери минимум два правильных варианта.');
    if (kind !== 'multiple_choice' && a.value.length !== opts.length)
      fail('Используй все элементы в правильном порядке.');
    if (kind === 'spelling' && opts.some((o) => !/^[a-zA-Z]$/.test(o.label)))
      fail('В каждом элементе должна быть одна английская буква.');
    return {
      public_payload: { [field]: opts },
      answer_key: { value: a.value as string[] },
    };
  }
  if (kind === 'unit_test') {
    keys(p, ['questions']);
    keys(a, ['answers', 'explanations']);
    if (
      !Array.isArray(p.questions) ||
      p.questions.length < 2 ||
      p.questions.length > 10
    )
      fail('В контрольном блоке нужно от 2 до 10 вопросов.');
    const answers = obj(a.answers),
      explanations = obj(a.explanations);
    const questions = p.questions.map((x) => {
      const q = obj(x);
      keys(q, ['id', 'prompt', 'options']);
      const qid = id(q.id),
        opts = items(q.options);
      if (!opts.some((o) => o.id === answers[qid]))
        fail('Укажи правильный ответ на каждый контрольный вопрос.');
      text(explanations[qid], 1000);
      return { id: qid, prompt: text(q.prompt, 500), options: opts };
    });
    if (new Set(questions.map((q) => q.id)).size !== questions.length)
      fail('ID контрольных вопросов повторяются.');
    if (
      Object.keys(answers).length !== questions.length ||
      Object.keys(explanations).length !== questions.length
    )
      fail('Число ответов и объяснений не совпадает с вопросами.');
    return {
      public_payload: { questions },
      answer_key: {
        answers: Object.fromEntries(
          questions.map((q) => [q.id, answers[q.id] as string]),
        ),
        explanations: Object.fromEntries(
          questions.map((q) => [q.id, explanations[q.id] as string]),
        ),
      },
    };
  }
  if (choiceKinds.includes(kind)) {
    const fields: Record<string, string[]> = {
      error_identification: ['sentence'],
      context_choice: ['sentence'],
      reading: ['passage'],
      dialogue: ['lines'],
      response_choice: ['context'],
      tenses: ['sentence'],
      synonym_antonym: ['word', 'relation'],
      word_review: ['word'],
    };
    const extra = fields[kind];
    if (!extra) fail('Неподдерживаемый формат задания.');
    keys(p, ['options', ...extra]);
    keys(a, ['value']);
    const options = items(p.options),
      value = id(a.value);
    if (!options.some((o) => o.id === value))
      fail('Выбери правильный вариант из списка.');
    const result: ExercisePayload = { options };
    for (const field of extra) {
      if (field === 'lines') {
        if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > 8)
          fail('В диалоге нужна 1–8 реплик.');
        result.lines = (p.lines as unknown[]).map((x) => {
          const l = obj(x);
          keys(l, ['speaker', 'text']);
          return { speaker: text(l.speaker, 40), text: text(l.text, 400) };
        });
      } else if (field === 'relation') {
        if (!['synonym', 'antonym'].includes(p.relation as string))
          fail('Выбери синоним или антоним.');
        result.relation = p.relation as 'synonym' | 'antonym';
      } else
        Object.assign(result, {
          [field]: text(
            p[field],
            field === 'passage'
              ? 5000
              : field === 'word'
                ? 200
                : field === 'context'
                  ? 1000
                  : 500,
          ),
        });
    }
    return { public_payload: result, answer_key: { value } };
  }
  return fail('Неподдерживаемый формат задания.');
}
