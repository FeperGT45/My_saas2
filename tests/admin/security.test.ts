import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdmin } from '../../src/lib/admin/access';
import {
  dispatchAdmin,
  type AdminDependencies,
} from '../../src/lib/admin/controller';
import {
  parseAdminCommand,
  parseAdminQuery,
  validateExercise,
} from '../../src/lib/admin/validation';
import type { SessionUser } from '../../src/lib/auth/session';
const actor = 'a0000000-0000-0000-0000-000000000001';
const other = 'a0000000-0000-0000-0000-000000000002';
const course = 'b0000000-0000-0000-0000-000000000001';
const user: SessionUser = {
  id: actor,
  name: 'Admin',
  mode: 'telegram',
  telegramId: '123',
  avatarUrl: null,
};
const command = {
  requestId: 'c0000000-0000-0000-0000-000000000001',
  entity: 'course',
  data: {
    id: course,
    version: 0,
    language_id: '10000000-0000-0000-0000-000000000001',
    slug: 'new-course',
    title: 'Новый курс',
    level: 'A1',
    published: false,
    access_tier: 'free',
  },
  confirmation: `SAVE:course:${course}`,
};
const req = (
  method = 'GET',
  body: unknown = command,
  headers: Record<string, string> = {},
) =>
  new Request('https://example.test/api/admin?view=users', {
    method,
    headers: {
      origin: 'https://example.test',
      'content-type': 'application/json',
      ...headers,
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
function deps(
  session: SessionUser | null = user,
): AdminDependencies & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    adminIds: actor,
    getUser: async () => session,
    assertOrigin: (r) => {
      if (r.headers.get('origin') !== 'https://example.test') throw new Error();
    },
    read: async () => {
      calls.push('read');
      return { items: [], total: 0 };
    },
    save: async (id, c) => {
      calls.push(`save:${id}:${c.entity}`);
      return { id: c.data.id, version: 1 };
    },
  };
}
test('admin configuration fails closed; client identities, local sessions and metadata cannot grant access', () => {
  assert.equal(isAdmin(user, actor), true);
  assert.equal(isAdmin(user, ` ${actor.toUpperCase()},${other} `), true);
  for (const config of [
    undefined,
    '',
    `bad,${actor}`,
    `${actor},`,
    '123',
    '@owner',
  ])
    assert.equal(isAdmin(user, config), false);
  assert.equal(isAdmin({ ...user, mode: 'local' }, actor), false);
  assert.equal(isAdmin({ ...user, id: other }, actor), false);
  assert.equal(isAdmin(null, actor), false);
});
test('anonymous, expired, ordinary and local users cannot read any admin view or mutate content', async () => {
  for (const session of [
    null,
    { ...user, id: other },
    { ...user, mode: 'local' as const },
  ]) {
    const d = deps(session);
    for (const view of [
      'overview',
      'users',
      'courses',
      'units',
      'lessons',
      'exercises',
      'activity',
      'subscriptions',
      'audit',
      'languages',
    ]) {
      const r = await dispatchAdmin(
        new Request(`https://example.test/api/admin?view=${view}`, {
          headers: { 'x-admin-id': actor, authorization: 'Bearer fake' },
        }),
        d,
      );
      assert.equal(r.status, session ? 403 : 401);
      assert.match(r.headers.get('cache-control')!, /no-store/);
    }
    assert.equal(
      (await dispatchAdmin(req('POST'), d)).status,
      session ? 403 : 401,
    );
    assert.deepEqual(d.calls, []);
  }
});
test('valid admin must pass Origin, strict validation and explicit confirmation before a write', async () => {
  const d = deps();
  assert.equal(
    (
      await dispatchAdmin(
        req('POST', command, { origin: 'https://evil.example' }),
        d,
      )
    ).status,
    403,
  );
  assert.equal(
    (await dispatchAdmin(req('POST', { ...command, confirmation: '' }), d))
      .status,
    400,
  );
  assert.equal(
    (await dispatchAdmin(req('POST', { ...command, role: 'admin' }), d)).status,
    400,
  );
  assert.equal(
    (
      await dispatchAdmin(
        req('POST', { ...command, data: { ...command.data, xp: 99999 } }),
        d,
      )
    ).status,
    400,
  );
  assert.deepEqual(d.calls, []);
  assert.equal((await dispatchAdmin(req(), d)).status, 200);
  assert.equal((await dispatchAdmin(req('POST'), d)).status, 200);
  assert.deepEqual(d.calls, ['read', `save:${actor}:course`]);
  d.adminIds = '';
  assert.equal((await dispatchAdmin(req(), d)).status, 403);
});
test('bounded request parser, pagination and redacted service errors', async () => {
  const d = deps();
  const oversized = new Request('https://example.test/api/admin', {
    method: 'POST',
    headers: {
      origin: 'https://example.test',
      'content-type': 'application/json',
    },
    body: 'x'.repeat(32769),
  });
  assert.equal((await dispatchAdmin(oversized, d)).status, 413);
  assert.equal(
    (
      await dispatchAdmin(
        req('POST', command, { 'content-type': 'text/plain' }),
        d,
      )
    ).status,
    415,
  );
  for (const q of [
    'view=users&offset=-1',
    'view=users&offset=1000001',
    'view=exercises',
    'view=users&role=admin',
    'view=users&view=overview',
    'view=other',
  ])
    assert.throws(() => parseAdminQuery(`https://example.test/?${q}`));
  d.read = async () => {
    throw new Error('PRIVATE_DATABASE_CANARY');
  };
  const failed = await dispatchAdmin(req(), d);
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('CANARY'));
  d.getUser = async () => {
    throw new Error('SESSION_SECRET_CANARY');
  };
  assert.equal((await dispatchAdmin(req(), d)).status, 503);
});
test('each of the six authoring formats validates answers and refuses malformed keys or public answer leakage', () => {
  const options = [
    { id: 'a', label: 'Hello' },
    { id: 'b', label: 'Goodbye' },
  ];
  for (const kind of ['single_choice', 'grammar', 'listening'] as const) {
    const payload = {
      options,
      ...(kind === 'listening' ? { text: 'Hello', lang: 'en-US' } : {}),
    };
    assert.equal(
      validateExercise(kind, payload, { value: 'a' }).answer_key.value,
      'a',
    );
    assert.throws(() => validateExercise(kind, payload, { value: 'forged' }));
    assert.throws(() =>
      validateExercise(
        kind,
        { ...payload, correctAnswer: 'a' },
        { value: 'a' },
      ),
    );
  }
  assert.deepEqual(
    validateExercise('sentence', { tokens: options }, { value: ['a', 'b'] })
      .answer_key.value,
    ['a', 'b'],
  );
  assert.throws(() =>
    validateExercise('sentence', { tokens: options }, { value: ['a', 'a'] }),
  );
  assert.throws(() =>
    validateExercise('sentence', { tokens: options }, { value: ['other'] }),
  );
  assert.deepEqual(
    validateExercise('gap', { sentence: 'I ___ here.' }, { accepted: ['am'] })
      .answer_key.accepted,
    ['am'],
  );
  assert.throws(() =>
    validateExercise('gap', { sentence: 'I am here.' }, { accepted: ['am'] }),
  );
  assert.throws(() =>
    validateExercise('gap', { sentence: 'I ___ here.' }, { accepted: [] }),
  );
  assert.deepEqual(
    validateExercise(
      'matching',
      { left: options, right: options },
      { pairs: { a: 'b', b: 'a' } },
    ).answer_key.pairs,
    { a: 'b', b: 'a' },
  );
  assert.throws(() =>
    validateExercise(
      'matching',
      { left: options, right: options },
      { pairs: { a: 'b', b: 'b' } },
    ),
  );
  assert.throws(() =>
    parseAdminCommand({
      ...command,
      data: { ...command.data, title: '', published: 'true' },
    }),
  );
});
