import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PlacementStatus, PlacementResponse } from '@/lib/placement/types';
import { placementCommand } from '@/lib/placement/validation';
const db = new PGlite();
async function rpc<T = PlacementStatus>(
  name: string,
  args: unknown[] = [],
): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
  return (
    await db.query<{ data: T }>(
      `SELECT public.${name}(${placeholders}) AS data`,
      args,
    )
  ).rows[0].data;
}
async function user() {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)', [id]);
  await db.query(
    "INSERT INTO public.users(id,display_name) VALUES($1,'Placement learner')",
    [id],
  );
  return id;
}
async function status(id: string) {
  return rpc('placement_status', [id]);
}
async function answer(
  id: string,
  s: PlacementStatus,
  right = true,
  request = randomUUID(),
) {
  const a = s.attempt!;
  const q = a.question!;
  const key = (
    await db.query<{ key: string }>(
      "SELECT current_snapshot->>'correct_option' AS key FROM public.placement_test_attempts WHERE id=$1",
      [a.id],
    )
  ).rows[0].key;
  const option = right ? key : q.options.find((o) => o.id !== key)!.id;
  const response = await rpc<PlacementResponse>('placement_answer', [
    id,
    a.id,
    q.id,
    request,
    option,
  ]);
  return { response, option, request, question: q.id, attempt: a.id };
}
async function complete(
  id: string,
  right: boolean | ((difficulty: number, n: number) => boolean),
) {
  let s = await rpc('placement_start', [id, randomUUID()]);
  const seen = new Set<string>();
  let n = 0;
  while (s.attempt) {
    const q = s.attempt.question!;
    expect(seen.has(q.id)).toBe(false);
    seen.add(q.id);
    const d = (
      await db.query<{ rank: number }>(
        "SELECT public.placement_rank(current_snapshot->>'level') AS rank FROM public.placement_test_attempts WHERE id=$1",
        [s.attempt.id],
      )
    ).rows[0].rank;
    s = (await answer(id, s, typeof right === 'boolean' ? right : right(d, n)))
      .response.status;
    n++;
    expect(n).toBeLessThanOrEqual(20);
  }
  return { s, n };
}
beforeAll(async () => {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`,
  );
  for (const f of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
  await db.exec(
    await readFile('tests/fixtures/legacy-engine-seed.sql', 'utf8'),
  );
  await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
}, 30000);
afterEach(async () => {
  await db.exec('RESET ROLE');
});
afterAll(async () => {
  await db.close();
});
describe('placement content and protocol', () => {
  it('imports 120 reviewed questions covering every level/category with valid private keys, repeatably', async () => {
    const bank = JSON.parse(
      await readFile('content/placement-en-ru.v1.json', 'utf8'),
    );
    expect(bank.questions).toHaveLength(120);
    expect(
      new Set(bank.questions.map((q: { code: string }) => q.code)).size,
    ).toBe(120);
    for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
      for (const category of ['grammar', 'vocabulary', 'reading']) {
        const rows = bank.questions.filter(
          (q: { level: string; category: string }) =>
            q.level === level && q.category === category,
        );
        expect(rows.length).toBeGreaterThanOrEqual(6);
        for (const q of rows) {
          expect(q.options).toHaveLength(4);
          expect(
            q.options.some((o: { id: string }) => o.id === q.correctOption),
          ).toBe(true);
          expect(q.explanation).toMatch(/[а-яё]/i);
          if (category === 'reading')
            expect(q.passage.length).toBeGreaterThan(20);
        }
      }
    const before = (
      await db.query(
        'SELECT id FROM public.placement_test_questions ORDER BY id',
      )
    ).rows;
    await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
    expect(
      (
        await db.query(
          'SELECT id FROM public.placement_test_questions ORDER BY id',
        )
      ).rows,
    ).toEqual(before);
    expect(await rpc('placement_database_status')).toMatchObject({
      ready: true,
      questions: 120,
      tables: 5,
    });
  });
  it('rejects identity, score and correctness fields supplied by the browser', () => {
    for (const raw of [
      { action: 'answer', userId: randomUUID() },
      { action: 'beginner', level: 'C2' },
      { action: 'route', level: 'C3' },
      { action: 'start', requestId: randomUUID(), score: 100 },
      { action: 'beginner', correct: true },
    ])
      expect(() => placementCommand(raw)).toThrow();
  });
  it('first launch, beginner skip and repeats persist A1 without creating fake skill scores', async () => {
    const id = await user();
    expect(await status(id)).toMatchObject({
      onboarded: false,
      assessment: null,
      attempt: null,
    });
    const s = await rpc('placement_beginner', [id]);
    expect(s).toMatchObject({
      onboarded: true,
      assessment: {
        level: 'A1',
        source: 'beginner',
        questions: 0,
        categories: {},
      },
    });
    expect(s.recommendations.length).toBeGreaterThan(0);
    expect(await rpc('placement_beginner', [id])).toEqual(s);
  });
  it('starts at A1, adapts upward/downward, resumes exactly and hides answer keys', async () => {
    const id = await user();
    let s = await rpc('placement_start', [id, randomUUID()]);
    const first = s.attempt!.question!.id;
    const rank = async () =>
      (
        await db.query<{ rank: number }>(
          "SELECT public.placement_rank(current_snapshot->>'level') AS rank FROM public.placement_test_attempts WHERE id=$1",
          [s.attempt!.id],
        )
      ).rows[0].rank;
    expect(await rank()).toBe(1);
    expect(JSON.stringify(s)).not.toMatch(
      /correct_option|correctOption|explanation|posterior/,
    );
    s = (await answer(id, s, true)).response.status;
    expect(await rank()).toBe(2);
    expect(s.attempt!.question!.id).not.toBe(first);
    s = (await answer(id, s, false)).response.status;
    expect(await rank()).toBe(1);
    expect(await status(id)).toEqual(s);
    expect(await rpc('placement_start', [id, randomUUID()])).toEqual(s);
    expect(s.assessment).toBeNull();
    expect(s.attempt!.answered).toBe(2);
  });
  it('answer retry is idempotent; changing a committed answer or reusing its request for another question is rejected', async () => {
    const id = await user();
    const s = await rpc('placement_start', [id, randomUUID()]);
    const saved = await answer(id, s, true);
    expect(
      await rpc('placement_answer', [
        id,
        saved.attempt,
        saved.question,
        saved.request,
        saved.option,
      ]),
    ).toEqual(saved.response);
    await expect(
      rpc('placement_answer', [
        id,
        saved.attempt,
        saved.question,
        randomUUID(),
        s.attempt!.question!.options.find((o) => o.id !== saved.option)!.id,
      ]),
    ).rejects.toThrow(/conflict/);
    await expect(
      answer(id, saved.response.status, true, saved.request),
    ).rejects.toThrow(/conflict/);
    expect((await status(id)).attempt!.answered).toBe(1);
  });
  it('question revision cannot change the answer to a question already served', async () => {
    const id = await user();
    const s = await rpc('placement_start', [id, randomUUID()]);
    const q = s.attempt!.question!;
    const saved = (
      await db.query<{ key: string }>(
        "SELECT current_snapshot->>'correct_option' AS key FROM public.placement_test_attempts WHERE id=$1",
        [s.attempt!.id],
      )
    ).rows[0].key;
    const changed = q.options.find((o) => o.id !== saved)!.id;
    await db.query(
      'UPDATE public.placement_test_questions SET correct_option=$1 WHERE id=$2',
      [changed, q.id],
    );
    const response = await rpc<PlacementResponse>('placement_answer', [
      id,
      s.attempt!.id,
      q.id,
      randomUUID(),
      saved,
    ]);
    expect(response.feedback!.correct).toBe(true);
    await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
  });
  it('does not produce a high level from one or two correct answers, even with perfect early responses', async () => {
    const id = await user();
    let s = await rpc('placement_start', [id, randomUUID()]);
    for (let n = 0; n < 11; n++) {
      s = (await answer(id, s, true)).response.status;
      expect(s.assessment).toBeNull();
      expect(s.attempt).not.toBeNull();
    }
  });
  it('terminates at 12–20 questions with conservative low/high results and all skill categories', async () => {
    const low = await complete(await user(), false);
    const high = await complete(await user(), true);
    expect(low.s.assessment!.level).toBe('A1');
    expect(['C1', 'C2']).toContain(high.s.assessment!.level);
    for (const result of [low, high]) {
      expect(result.n).toBeGreaterThanOrEqual(12);
      expect(result.n).toBeLessThanOrEqual(20);
      expect(Object.keys(result.s.assessment!.categories).sort()).toEqual([
        'grammar',
        'reading',
        'vocabulary',
      ]);
      expect(result.s.history).toHaveLength(1);
      expect(result.s.onboarded).toBe(true);
    }
  });
  it('mixed answers reach the cap or a confident stop and retain uncertainty', async () => {
    const { s, n } = await complete(
      await user(),
      (d, i) => d <= 2 && i % 3 !== 0,
    );
    expect(n).toBeGreaterThanOrEqual(12);
    expect(n).toBeLessThanOrEqual(20);
    expect(s.assessment!.interval).not.toBeNull();
    expect(['A1', 'A2', 'B1']).toContain(s.assessment!.level);
  });
  it('retesting keeps history and previously completed lessons/XP, and updates only assessment/recommendations', async () => {
    const id = await user();
    const lesson = '40000000-0000-0000-0000-000000000001';
    await db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,85)',
      [id, lesson],
    );
    const before = (
      await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [
        id,
      ])
    ).rows;
    await complete(id, false);
    const { s } = await complete(id, true);
    expect(s.history).toHaveLength(2);
    expect(['C1', 'C2']).toContain(s.assessment!.level);
    expect(
      (
        await db.query('SELECT * FROM public.user_progress WHERE user_id=$1', [
          id,
        ])
      ).rows,
    ).toEqual(before);
    expect(
      (await db.query('SELECT * FROM public.xp_events WHERE user_id=$1', [id]))
        .rows,
    ).toHaveLength(0);
    expect((await rpc('placement_beginner', [id])).assessment!.source).toBe(
      'adaptive',
    );
  });
  it('route changes never rewrite assessment, respect prerequisites and fall back to published available material', async () => {
    const id = await user();
    const beginner = await rpc('placement_beginner', [id]);
    const start = beginner.recommendations[0];
    expect(start).toBeDefined();
    const advanced = await rpc('placement_set_route', [id, 'C2']);
    expect(advanced.routeLevel).toBe('C2');
    expect(advanced.assessment!.level).toBe('A1');
    expect(advanced.recommendations.length).toBeGreaterThan(0);
    // The second lesson is not eligible until its preceding lesson is completed.
    const second = '40000000-0000-0000-0000-000000000002';
    expect(beginner.recommendations.some((r) => r.lesson_id === second)).toBe(
      false,
    );
    await db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) VALUES($1,$2,80)',
      [id, '40000000-0000-0000-0000-000000000001'],
    );
    expect(
      (await status(id)).recommendations.some((r) => r.lesson_id === second),
    ).toBe(true);
  });

  it('suitable completed material is preferred over a new mismatched level', async () => {
    const id = await user();
    await rpc('placement_beginner', [id]);
    await db.query(
      'INSERT INTO public.user_progress(user_id,lesson_id,best_score) SELECT $1,id,85 FROM public.lessons',
      [id],
    );
    const course = randomUUID(),
      unit = randomUUID(),
      lesson = randomUUID();
    const lang = (
      await db.query<{ id: string }>(
        "SELECT id FROM public.languages WHERE code='en'",
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO public.courses(id,language_id,slug,title,level,published) VALUES($1,$2,$3,'Level A2','A2',true)",
      [course, lang, 'priority-' + course],
    );
    await db.query(
      "INSERT INTO public.units(id,course_id,title,position) VALUES($1,$2,'Section',1)",
      [unit, course],
    );
    await db.query(
      "INSERT INTO public.lessons(id,unit_id,title,position,published) VALUES($1,$2,'Published candidate',1,true)",
      [lesson, unit],
    );
    try {
      const s = await status(id);
      expect(s.recommendations[0].level).toBe('A1');
      expect(s.recommendations[0].review).toBe(true);
      const next = await rpc('placement_set_route', [id, 'C2']);
      expect(next.recommendations[0].level).toBe('A2');
      expect(next.recommendations[0].review).toBe(false);
    } finally {
      await db.query('DELETE FROM public.courses WHERE id=$1', [course]);
    }
  });
  it('another user cannot answer or resume an attempt through supplied IDs', async () => {
    const a = await user(),
      b = await user();
    const s = await rpc('placement_start', [a, randomUUID()]);
    await expect(
      rpc('placement_answer', [
        b,
        s.attempt!.id,
        s.attempt!.question!.id,
        randomUUID(),
        'a',
      ]),
    ).rejects.toThrow(/unavailable/);
    await expect(rpc('placement_start', [b, s.attempt!.id])).rejects.toThrow(
      /unavailable/,
    );
    expect((await status(b)).attempt).toBeNull();
    expect((await status(b)).history).toEqual([]);
  });

  it('parallel starts resolve to one unfinished attempt', async () => {
    const id = await user();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        rpc('placement_start', [id, randomUUID()]),
      ),
    );
    expect(new Set(results.map((r) => r.attempt!.id)).size).toBe(1);
    expect(
      (
        await db.query(
          "SELECT id FROM public.placement_test_attempts WHERE user_id=$1 AND status='active'",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it('failed content imports roll back and broken bank/permissions fail readiness', async () => {
    const bank = JSON.parse(
      await readFile('content/placement-en-ru.v1.json', 'utf8'),
    );
    const first = bank.questions[0];
    const bad = {
      ...bank,
      questions: [
        { ...first, prompt: 'Изменение, которое не должно сохраниться' },
        { ...bank.questions[1], correctOption: 'x' },
      ],
    };
    await expect(
      rpc('placement_import_questions', [JSON.stringify(bad)]),
    ).rejects.toThrow();
    expect(
      (
        await db.query<{ prompt: string }>(
          'SELECT prompt FROM public.placement_test_questions WHERE code=$1',
          [first.code],
        )
      ).rows[0].prompt,
    ).toBe(first.prompt);
    await db.query(
      'UPDATE public.placement_test_questions SET active=false WHERE code=$1',
      [first.code],
    );
    expect(await rpc('placement_database_status')).toMatchObject({
      ready: false,
    });
    await db.exec(await readFile('supabase/placement-seed.sql', 'utf8'));
    await db.exec(
      'REVOKE EXECUTE ON FUNCTION public.placement_start(uuid,uuid) FROM service_role',
    );
    try {
      expect(await rpc('placement_database_status')).toMatchObject({
        ready: false,
      });
    } finally {
      await db.exec(
        'GRANT EXECUTE ON FUNCTION public.placement_start(uuid,uuid) TO service_role',
      );
    }
    expect(await rpc('placement_database_status')).toMatchObject({
      ready: true,
    });
  });
  it('daily attempt limit does not prevent resuming an existing attempt', async () => {
    const id = await user();
    for (let i = 0; i < 4; i++) await complete(id, false);
    const s = await rpc('placement_start', [id, randomUUID()]);
    expect((await rpc('placement_start', [id, randomUUID()])).attempt!.id).toBe(
      s.attempt!.id,
    );
    await complete(id, false);
    await expect(rpc('placement_start', [id, randomUUID()])).rejects.toThrow(
      /daily limit/,
    );
  });
  it.each(['anon', 'authenticated'])(
    '%s cannot read keys/private results or modify results through Supabase',
    async (role) => {
      await db.exec(`SET ROLE ${role}`);
      for (const table of [
        'placement_test_questions',
        'placement_test_attempts',
        'placement_test_answers',
        'user_language_levels',
        'user_skill_assessments',
      ]) {
        await expect(
          db.exec(`SELECT * FROM public.${table}`),
        ).rejects.toThrow();
        await expect(db.exec(`DELETE FROM public.${table}`)).rejects.toThrow();
      }
      await expect(
        db.exec(
          "SELECT public.placement_status('a0000000-0000-0000-0000-000000000001')",
        ),
      ).rejects.toThrow();
    },
  );
});
