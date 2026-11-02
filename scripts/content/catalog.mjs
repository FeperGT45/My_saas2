import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const catalogPath = new URL(
  '../../content/english-ru.v1.json',
  import.meta.url,
);
export async function readCatalog() {
  const data = JSON.parse(await readFile(catalogPath, 'utf8'));
  validateCatalog(data);
  return data;
}
const kinds = [
  'single_choice',
  'sentence',
  'gap',
  'matching',
  'grammar',
  'listening',
];
const text = (value, path) =>
  assert.ok(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 5000,
    `${path}: expected nonempty text`,
  );
const unique = (values, path) =>
  assert.equal(new Set(values).size, values.length, `${path}: duplicates`);
function list(items, path, allowRepeatedLabels = false) {
  assert.ok(
    Array.isArray(items) && items.length >= 2 && items.length <= 30,
    `${path}: expected 2–30 items`,
  );
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'label']);
    text(item.id, path);
    text(item.label, path);
  }
  unique(
    items.map((i) => i.id),
    path,
  );
  if (!allowRepeatedLabels)
    unique(
      items.map((i) => i.label.toLowerCase()),
      path,
    );
}
export function validateCatalog(data) {
  assert.equal(data.schemaVersion, 1);
  assert.match(data.contentVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(data.language.code, 'en');
  assert.equal(data.interfaceLocale, 'ru');
  assert.equal(data.courses.length, 3);
  const counts = {
    'Basic English': 12,
    'Gaming English': 10,
    'Internet English': 8,
  };
  unique(
    data.courses.map((c) => c.slug),
    'courses',
  );
  for (const course of data.courses) {
    text(course.description, course.slug);
    assert.equal(course.lessons.length, counts[course.title]);
    assert.ok(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(course.level));
    unique(
      course.lessons.map((l) => l.slug),
      course.slug,
    );
    const positions = new Set();
    const units = new Map();
    for (const lesson of course.lessons) {
      const path = `${course.slug}/${lesson.slug}`;
      text(lesson.title, path);
      assert.match(lesson.slug, /^[a-z0-9-]+$/);
      assert.ok(lesson.objectives.length >= 2 && lesson.notes.length >= 2);
      for (const t of [...lesson.objectives, ...lesson.notes]) text(t, path);
      assert.ok(lesson.xp_reward >= 0 && lesson.xp_reward <= 1000);
      assert.ok(Number.isInteger(lesson.position) && lesson.position > 0);
      assert.ok(
        Number.isInteger(lesson.unit.position) && lesson.unit.position > 0,
      );
      text(lesson.unit.title, path);
      const prior = units.get(lesson.unit.slug);
      if (prior) assert.deepEqual(prior, lesson.unit);
      else units.set(lesson.unit.slug, lesson.unit);
      const position = `${lesson.unit.slug}/${lesson.position}`;
      assert.ok(!positions.has(position), `${path}: duplicate lesson position`);
      positions.add(position);
      assert.ok(lesson.exercises.length >= 8 && lesson.exercises.length <= 100);
      unique(
        lesson.exercises.map((e) => e.key),
        path,
      );
      assert.equal(new Set(lesson.exercises.map((e) => e.kind)).size, 6);
      assert.ok(lesson.lexicon.length >= 4);
      unique(
        lesson.lexicon.map((v) => v.en),
        path,
      );
      unique(
        lesson.lexicon.map((v) => v.ru),
        path,
      );
      for (const v of lesson.lexicon) {
        text(v.en, path);
        text(v.ru, path);
      }
      for (const e of lesson.exercises) {
        text(e.prompt, path);
        text(e.explanation, path);
        assert.ok(kinds.includes(e.kind), `${path}: unsupported kind`);
        assert.match(e.key, /^e\d{2}$/);
        const p = e.public_payload,
          a = e.answer_key;
        let reference;
        if (['single_choice', 'grammar', 'listening'].includes(e.kind)) {
          list(p.options, path);
          assert.deepEqual(
            Object.keys(p).sort(),
            e.kind === 'listening' ? ['lang', 'options', 'text'] : ['options'],
          );
          assert.deepEqual(Object.keys(a), ['value']);
          reference = p.options.find((o) => o.id === a.value)?.label;
          assert.ok(reference, `${path}: missing correct option`);
          if (e.kind === 'listening') {
            text(p.text, path);
            assert.equal(p.lang, 'en-US');
          }
        }
        if (e.kind === 'sentence') {
          list(p.tokens, path, true);
          assert.deepEqual(Object.keys(p), ['tokens']);
          assert.deepEqual(Object.keys(a), ['value']);
          assert.ok(
            Array.isArray(a.value) && a.value.length === p.tokens.length,
          );
          unique(a.value, path);
          reference = a.value
            .map((id) => {
              const item = p.tokens.find((t) => t.id === id);
              assert.ok(item);
              return item.label;
            })
            .join(' ');
          assert.notDeepEqual(
            p.tokens.map((t) => t.id),
            a.value,
            `${path}: unshuffled sentence`,
          );
        }
        if (e.kind === 'gap') {
          assert.deepEqual(Object.keys(p), ['sentence']);
          assert.deepEqual(Object.keys(a), ['accepted']);
          assert.equal(p.sentence.split('___').length, 2);
          assert.ok(Array.isArray(a.accepted) && a.accepted.length);
          for (const word of a.accepted) {
            text(word, path);
            assert.ok(!word.includes(' '), `${path}: one word required`);
          }
          reference = a.accepted[0];
        }
        if (e.kind === 'matching') {
          list(p.left, path);
          list(p.right, path);
          assert.deepEqual(Object.keys(p).sort(), ['left', 'right']);
          assert.deepEqual(Object.keys(a), ['pairs']);
          assert.deepEqual(
            Object.keys(a.pairs).sort(),
            p.left.map((x) => x.id).sort(),
          );
          assert.deepEqual(
            Object.values(a.pairs).sort(),
            p.right.map((x) => x.id).sort(),
          );
          reference = Object.fromEntries(
            p.left.map((l) => [
              l.label,
              p.right.find((r) => r.id === a.pairs[l.id]).label,
            ]),
          );
        }
        assert.deepEqual(
          reference,
          e.reference_answer,
          `${path}/${e.key}: editorial reference mismatch`,
        );
        // Checks only reference answers, never deliberately incorrect distractors.
        if (['grammar', 'sentence'].includes(e.kind))
          assert.ok(
            !/\b(?:I is|I are|she are|he are|can to|can plays|should to|will to|doesn't likes|doesn't works)\b/i.test(
              reference,
            ),
            `${path}: grammar regression`,
          );
      }
    }
    unique(
      [...units.values()].map((u) => u.position),
      `${course.slug}/units`,
    );
  }
  return data;
}
// UUIDv5 with a fixed namespace: revisions and reordering do not create new rows.
export function contentId(key) {
  const namespace = Buffer.from('dcc8322b873b5e7c8b2af28d480f45f4', 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(key)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function importPayload(data) {
  validateCatalog(data);
  const result = {
    language: data.language,
    content_version: data.contentVersion,
    courses: [],
    units: [],
    lessons: [],
    exercises: [],
  };
  for (const c of data.courses) {
    const courseId = contentId(`course/${c.slug}`);
    result.courses.push({
      id: courseId,
      slug: c.slug,
      title: c.title,
      level: c.level,
      description: c.description,
    });
    const units = new Set();
    for (const l of c.lessons) {
      const unitId = contentId(`unit/${c.slug}/${l.unit.slug}`);
      if (!units.has(unitId)) {
        units.add(unitId);
        result.units.push({
          id: unitId,
          course_id: courseId,
          title: l.unit.title,
          position: l.unit.position,
        });
      }
      const lessonId = contentId(`lesson/${c.slug}/${l.slug}`);
      result.lessons.push({
        id: lessonId,
        unit_id: unitId,
        title: l.title,
        position: l.position,
        xp_reward: l.xp_reward,
        objectives: l.objectives,
        notes: l.notes,
        lexicon: l.lexicon,
      });
      for (const [index, e] of l.exercises.entries())
        result.exercises.push({
          id: contentId(`exercise/${c.slug}/${l.slug}/${e.key}`),
          lesson_id: lessonId,
          kind: e.kind,
          prompt: e.prompt,
          position: index + 1,
          public_payload: e.public_payload,
          answer_key: e.answer_key,
          explanation: e.explanation,
        });
    }
  }
  return result;
}
