import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {
  readServiceConfiguration,
  validatePublicKey,
} from '../../src/lib/supabase/config';
import {
  requiredTables,
  isDatabaseReady,
} from '../../src/lib/supabase/readiness';
const healthy = () => ({
  schemaVersion: '202611020008',
  ready: true,
  protectedColumns: true,
  rpcPermissions: true,
  tables: requiredTables.map((name) => ({
    name,
    exists: true,
    rls: true,
    clientWritesDenied: true,
    privateReadsDenied: true,
  })),
});
test('configuration accepts secret and legacy keys, rejects unsafe URLs and public service keys', () => {
  assert.deepEqual(
    readServiceConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_canary',
    }),
    { url: 'https://example.supabase.co', serviceKey: 'sb_secret_canary' },
  );
  assert.equal(
    readServiceConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    }).serviceKey,
    'legacy',
  );
  for (const url of [
    '',
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/?secret=private',
    'https://example.com/rest/v1',
  ])
    assert.throws(() =>
      readServiceConfiguration({
        NEXT_PUBLIC_SUPABASE_URL: url,
        SUPABASE_SECRET_KEY: 'sb_secret_canary',
      }),
    );
  assert.throws(() =>
    readServiceConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NODE_ENV: 'production',
      SUPABASE_SECRET_KEY: 'sb_secret_canary',
    }),
  );
  assert.throws(() =>
    readServiceConfiguration({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    }),
  );
  const jwt = (role: string) =>
    `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(validatePublicKey(jwt('anon')), jwt('anon'));
  assert.throws(() => validatePublicKey(jwt('service_role')));
  assert.throws(() => validatePublicKey(' sb_secret_canary '));
});
test('readiness refuses missing tables, relaxed privileges, stale versions or forged ready flag', () => {
  assert.equal(isDatabaseReady(healthy()), true);
  for (const mutate of [
    (s: ReturnType<typeof healthy>) => {
      s.tables.pop();
    },
    (s: ReturnType<typeof healthy>) => {
      s.tables[0].rls = false;
    },
    (s: ReturnType<typeof healthy>) => {
      s.tables[1].clientWritesDenied = false;
    },
    (s: ReturnType<typeof healthy>) => {
      s.protectedColumns = false;
    },
    (s: ReturnType<typeof healthy>) => {
      s.rpcPermissions = false;
    },
    (s: ReturnType<typeof healthy>) => {
      s.schemaVersion = 'older';
    },
  ]) {
    const report = healthy();
    mutate(report);
    assert.equal(isDatabaseReady(report), false);
  }
});
function cli(extra: Record<string, string>) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const env = { ...process.env };
      for (const key of [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_SECRET_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'NODE_ENV',
      ])
        delete env[key];
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'scripts/check-supabase.ts'],
        { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (c) => (output += c));
      child.stderr.on('data', (c) => (output += c));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    },
  );
}
test('CLI checks connection read-only, returns nonzero on failure and redacts secrets/errors', async () => {
  let status = 200;
  let report: unknown = healthy();
  let called = 0;
  const canary = 'sb_secret_CREDENTIAL_DO_NOT_LOG';
  const server = createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/rest/v1/rpc/voklumi_database_status');
    assert.equal(req.headers.apikey, canary);
    called++;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const missing = await cli({ SUPABASE_SECRET_KEY: canary });
    assert.equal(missing.code, 2);
    assert.ok(!missing.output.includes(canary));
    assert.equal(called, 0);
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      SUPABASE_SECRET_KEY: canary,
    };
    const success = await cli(env);
    assert.equal(success.code, 0);
    assert.match(success.output, /19 tables/);
    assert.ok(!success.output.includes(canary));
    status = 400;
    report = { message: `INTERNAL_PRIVATE_ERROR ${canary}` };
    const fail = await cli(env);
    assert.equal(fail.code, 1);
    assert.ok(!fail.output.includes(canary));
    assert.ok(!fail.output.includes('INTERNAL_PRIVATE_ERROR'));
    status = 200;
    report = { ...healthy(), rpcPermissions: false };
    assert.equal((await cli(env)).code, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
