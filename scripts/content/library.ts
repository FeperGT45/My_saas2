import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateExercise } from '../../src/lib/admin/validation';
import { cefrLevels, type CefrLevel } from '../../src/lib/placement/types';
import type {
  ExerciseKind,
  ExercisePayload,
  ExerciseKey,
} from '../../src/lib/exercises/contracts';
import type { Answer } from '../../src/features/lesson/types';
export type LibraryExercise = {
  key: string;
  kind: ExerciseKind;
  prompt: string;
  public_payload: ExercisePayload;
  answer_key: ExerciseKey;
  reference_answer: Answer;
  incorrect_answer: Answer;
  editorial_answer: string;
  explanation: string;
};
export type LibraryLesson = {
  key: string;
  course: string;
  unit: { slug: string; title: string; position: number };
  position: number;
  title: string;
  description: string;
  level: CefrLevel;
  objectives: string[];
  notes: string[];
  skills: string[];
  estimated_minutes: number;
  prerequisites: string[];
  lexicon: { en: string; ru: string }[];
  quality: { status: string; method: string; cefr: string; license: string };
  exercises: LibraryExercise[];
};
export type Manifest = {
  schemaVersion: 2;
  packageId: string;
  revision: number;
  language: 'en';
  interfaceLocale: 'ru';
  courses: {
    slug: string;
    title: string;
    description: string;
    level: CefrLevel;
    goals: string[];
  }[];
  lessons: string[];
};
export type Library = { manifest: Manifest; lessons: LibraryLesson[] };
const root = new URL('../../content/library/', import.meta.url);
const nonempty = (v: unknown, max = 2000) =>
  assert.ok(
    typeof v === 'string' && v.trim().length > 0 && v.length <= max,
    'Missing or oversized content text',
  );
export function questionFingerprint(
  e: Pick<LibraryExercise, 'kind' | 'prompt' | 'public_payload'>,
): string {
  const norm = (s: string) =>
    s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const p = e.public_payload;
  const sorted = (items: { label: string }[] | undefined) =>
    items?.map((x) => norm(x.label)).sort();
  return JSON.stringify([
    e.kind,
    norm(e.prompt),
    {
      options: sorted(p.options),
      tokens: sorted(p.tokens),
      left: sorted(p.left),
      right: sorted(p.right),
      sentence: p.sentence && norm(p.sentence),
      source: p.source && norm(p.source),
      text: p.text && norm(p.text),
      passage: p.passage && norm(p.passage),
      context: p.context && norm(p.context),
      word: p.word && norm(p.word),
      relation: p.relation,
      lines: p.lines?.map((l) => [norm(l.speaker), norm(l.text)]),
      questions: p.questions
        ?.map((q) => [norm(q.prompt), sorted(q.options)])
        .sort(),
    },
  ]);
}
export const libraryId = (key: string) => {
  const bytes = createHash('sha1')
    .update(Buffer.from('dcc8322b873b5e7c8b2af28d480f45f4', 'hex'))
    .update('library/' + key)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
export async function loadLibrary(): Promise<Library> {
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', root), 'utf8'),
  ) as Manifest;
  assert.ok(Array.isArray(manifest.lessons));
  assert.ok(
    manifest.lessons.every((p) =>
      /^lessons\/(a1|a2|b1|b2|c1|c2)\/[a-z0-9-]+\.json$/.test(p),
    ),
    'Unsafe lesson path',
  );
  const lessons = await Promise.all(
    manifest.lessons.map(
      async (p) =>
        JSON.parse(await readFile(new URL(p, root), 'utf8')) as LibraryLesson,
    ),
  );
  const legacy = JSON.parse(
    await readFile(new URL('../english-ru.v1.json', root), 'utf8'),
  ) as { courses: { lessons: { exercises: LibraryExercise[] }[] }[] };
  const data = { manifest, lessons };
  validateLibrary(
    data,
    legacy.courses.flatMap((c) => c.lessons.flatMap((l) => l.exercises)),
  );
  return data;
}
export function validateLibrary(
  { manifest: m, lessons }: Library,
  existing: Pick<LibraryExercise, 'kind' | 'prompt' | 'public_payload'>[] = [],
) {
  assert.equal(m.schemaVersion, 2);
  assert.equal(m.language, 'en');
  assert.equal(m.interfaceLocale, 'ru');
  assert.match(m.packageId, /^[a-z0-9-]{3,80}$/);
  assert.ok(Number.isInteger(m.revision) && m.revision > 0);
  assert.ok(lessons.length > 0 && lessons.length <= 500);
  assert.equal(new Set(m.lessons).size, m.lessons.length);
  assert.equal(new Set(lessons.map((l) => l.key)).size, lessons.length);
  assert.equal(m.lessons.length, lessons.length);
  assert.equal(new Set(m.courses.map((c) => c.slug)).size, m.courses.length);
  for (const c of m.courses) {
    assert.match(c.slug, /^[a-z0-9-]+$/);
    nonempty(c.title, 160);
    nonempty(c.description);
    assert.ok(cefrLevels.includes(c.level));
    assert.ok(
      c.goals.length > 0 &&
        c.goals.every((g) =>
          ['general', 'communication', 'gaming', 'travel', 'study'].includes(g),
        ),
    );
  }
  const seen = new Set(existing.map(questionFingerprint)),
    positions = new Set<string>(),
    titles = new Set<string>();
  for (const l of lessons) {
    assert.match(l.key, /^(a1|a2|b1|b2|c1|c2)\/[a-z0-9-]+$/);
    assert.ok(m.lessons.includes('lessons/' + l.key + '.json'));
    const course = m.courses.find((c) => c.slug === l.course);
    assert.ok(course);
    assert.equal(l.level, course.level);
    assert.ok(cefrLevels.includes(l.level));
    for (const t of [l.title, l.description, ...l.objectives, ...l.notes])
      nonempty(t);
    assert.ok(/[а-яё]/i.test(l.title));
    assert.ok(l.description.length >= 20);
    assert.ok(l.objectives.length >= 2 && l.notes.length >= 2);
    assert.ok(
      l.skills.length > 0 &&
        l.skills.every((s) =>
          ['grammar', 'vocabulary', 'reading', 'listening'].includes(s),
        ),
    );
    assert.ok(
      Number.isInteger(l.estimated_minutes) &&
        l.estimated_minutes >= 3 &&
        l.estimated_minutes <= 30,
    );
    assert.equal(l.quality.status, 'checked');
    assert.equal(l.quality.license, 'original');
    assert.equal(l.quality.cefr, 'provisional');
    nonempty(l.quality.method);
    assert.ok(Number.isInteger(l.position) && l.position > 0);
    assert.ok(Number.isInteger(l.unit.position) && l.unit.position > 0);
    assert.match(l.unit.slug, /^[a-z0-9-]+$/);
    nonempty(l.unit.title);
    const position = `${l.course}/${l.unit.slug}/${l.position}`;
    assert.ok(!positions.has(position), 'Duplicate lesson position');
    positions.add(position);
    assert.ok(!titles.has(l.title), 'Duplicate lesson title');
    titles.add(l.title);
    assert.ok(l.lexicon.length >= 4 && l.lexicon.length <= 12);
    assert.equal(
      new Set(l.lexicon.map((v) => v.en.toLowerCase())).size,
      l.lexicon.length,
    );
    for (const v of l.lexicon) {
      nonempty(v.en, 200);
      nonempty(v.ru, 200);
      assert.ok(/[а-яё]/i.test(v.ru));
    }
    assert.ok(l.exercises.length >= 8 && l.exercises.length <= 15);
    assert.ok(new Set(l.exercises.map((e) => e.kind)).size >= 6);
    assert.equal(
      new Set(l.exercises.map((e) => e.key)).size,
      l.exercises.length,
    );
    for (const e of l.exercises) {
      assert.match(e.key, /^e\d{2}$/);
      nonempty(e.prompt, 1000);
      nonempty(e.explanation, 2000);
      nonempty(e.editorial_answer, 2000);
      assert.ok(/[а-яё]/i.test(e.explanation));
      assert.notDeepEqual(e.reference_answer, e.incorrect_answer);
      const checked = validateExercise(e.kind, e.public_payload, e.answer_key);
      assert.deepEqual(checked.public_payload, e.public_payload);
      assert.deepEqual(checked.answer_key, e.answer_key);
      const fingerprint = questionFingerprint(e);
      assert.ok(!seen.has(fingerprint), 'Duplicate exercise');
      seen.add(fingerprint);
      if (e.public_payload.options) {
        const labels = e.public_payload.options.map((o) =>
          o.label.toLocaleLowerCase().trim(),
        );
        assert.equal(
          new Set(labels).size,
          labels.length,
          'Repeated option labels',
        );
      }
      if (e.kind === 'reading') {
        const count = e.public_payload.passage!.split(/\s+/).length;
        assert.ok(
          count >= { A1: 15, A2: 30, B1: 45, B2: 65, C1: 90, C2: 110 }[l.level],
          'Reading too short for this package',
        );
      }
      // Regression guard on authored correct references, never on intentional distractors.
      assert.ok(
        !/\b(?:I is|I are|she are|he are|can to|should to|doesn't likes|doesn't works)\b/i.test(
          e.editorial_answer,
        ),
        'Unreviewed grammar regression',
      );
    }
    assert.equal(new Set(l.prerequisites).size, l.prerequisites.length);
    for (const key of l.prerequisites) {
      const prev = lessons.find((x) => x.key === key);
      assert.ok(prev && prev.course === l.course, 'Unknown prerequisite');
      assert.ok(
        prev.unit.position < l.unit.position ||
          (prev.unit.position === l.unit.position &&
            prev.position < l.position),
        'Prerequisite must precede lesson',
      );
    }
  }
  return {
    lessons: lessons.length,
    exercises: lessons.reduce((n, l) => n + l.exercises.length, 0),
    levels: Object.fromEntries(
      cefrLevels.map((level) => [
        level,
        lessons.filter((l) => l.level === level).length,
      ]),
    ),
  };
}
export function libraryPayload(data: Library) {
  validateLibrary(data);
  const m = data.manifest;
  const units = new Map<string, object>();
  const courses = m.courses.map((c) => ({
    ...c,
    id: libraryId(`${m.packageId}/course/${c.slug}`),
  }));
  const lessons = data.lessons.map((l) => {
    const course = courses.find((c) => c.slug === l.course)!;
    const unitId = libraryId(`${m.packageId}/unit/${l.course}/${l.unit.slug}`);
    units.set(unitId, { id: unitId, course_id: course.id, ...l.unit });
    return {
      id: libraryId(`${m.packageId}/lesson/${l.key}`),
      unit_id: unitId,
      title: l.title,
      position: l.position,
      description: l.description,
      level: l.level,
      objectives: l.objectives,
      notes: l.notes,
      lexicon: l.lexicon,
      skills: l.skills,
      estimated_minutes: l.estimated_minutes,
      prerequisites: l.prerequisites.map((key) =>
        libraryId(`${m.packageId}/lesson/${key}`),
      ),
      quality: l.quality,
      xp_reward: 30,
    };
  });
  const exercises = data.lessons.flatMap((l) =>
    l.exercises.map((e, i) => ({
      id: libraryId(`${m.packageId}/exercise/${l.key}/${e.key}`),
      lesson_id: libraryId(`${m.packageId}/lesson/${l.key}`),
      kind: e.kind,
      prompt: e.prompt,
      position: i + 1,
      public_payload: e.public_payload,
      answer_key: e.answer_key,
      reference_answer: e.reference_answer,
      incorrect_answer: e.incorrect_answer,
      explanation: e.explanation,
    })),
  );
  return {
    schema_version: 2,
    package_id: m.packageId,
    revision: m.revision,
    language: m.language,
    courses,
    units: [...units.values()],
    lessons,
    exercises,
  };
}
