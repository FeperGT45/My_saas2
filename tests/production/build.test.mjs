import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function scenario(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'voklumi-preflight-test-'));
  try {
    const log = join(directory, 'calls.jsonl');
    const preload = join(directory, 'fetch.mjs');
    writeFileSync(
      preload,
      `globalThis.fetch = async () => {
      if (process.env.TEST_TELEGRAM_FAIL) throw Error(process.env.TELEGRAM_BOT_TOKEN);
      return { ok: true, json: async () => ({ ok: true, result: { is_bot: true, username: 'Verified_bot' } }) };
    };`,
    );
    writeFileSync(
      join(directory, 'npm.cjs'),
      `#!/usr/bin/env node
      require('node:fs').appendFileSync(process.env.TEST_LOG, JSON.stringify({script: process.argv[3], username: process.env.TELEGRAM_BOT_USERNAME})+'\\n');
      if (process.argv[3] === 'db:check' && process.env.TEST_DB_FAIL) process.exit(1);
      if (process.argv[3] === 'placement:check' && process.env.TEST_PLACEMENT_FAIL) process.exit(1);
      if (process.argv[3] === 'learning:check' && process.env.TEST_LEARNING_FAIL) process.exit(1);
      if (process.argv[3] === 'exercises:check' && process.env.TEST_EXERCISES_FAIL) process.exit(1);
      if (process.argv[3] === 'library:db-check' && process.env.TEST_LIBRARY_FAIL) process.exit(1);
      if (process.argv[3] === 'premium:check' && process.env.TEST_PREMIUM_FAIL) process.exit(1);
    `,
      { mode: 0o700 },
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        resolve('scripts/build-production.mjs'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          npm_execpath: join(directory, 'npm.cjs'),
          TEST_LOG: log,
          APP_URL: 'https://app.example.com',
          NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
          SUPABASE_SECRET_KEY: 'server-fixture-do-not-log',
          TELEGRAM_BOT_TOKEN: 'telegram-fixture-do-not-log',
          TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
          TELEGRAM_BOT_USERNAME: 'Wrong_bot',
          ...overrides,
        },
      },
    );
    const output = result.stdout + result.stderr;
    assert.ok(!output.includes('server-fixture-do-not-log'));
    assert.ok(!output.includes('telegram-fixture-do-not-log'));
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
      : [];
    return { status: result.status, calls, output };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test('production build verifies database first and uses the verified bot username', () => {
  const result = scenario();
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, [
    { script: 'db:check', username: 'Verified_bot' },
    { script: 'placement:check', username: 'Verified_bot' },
    { script: 'learning:check', username: 'Verified_bot' },
    { script: 'exercises:check', username: 'Verified_bot' },
    { script: 'library:db-check', username: 'Verified_bot' },
    { script: 'premium:check', username: 'Verified_bot' },
    { script: 'build:cloudflare', username: 'Verified_bot' },
  ]);
});
test('failed database check blocks the release build', () => {
  const result = scenario({ TEST_DB_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.deepEqual(
    result.calls.map((call) => call.script),
    ['db:check'],
  );
});
test('Telegram transport errors are redacted and block the release build', () => {
  const result = scenario({ TEST_TELEGRAM_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
  assert.match(result.output, /Details redacted/);
});
test('missing secrets and unsafe origins block all integrations', () => {
  for (const overrides of [
    { TELEGRAM_BOT_TOKEN: '' },
    { TELEGRAM_WEBHOOK_SECRET: 'short' },
    { APP_URL: 'http://localhost' },
    { APP_URL: 'https://user:password@example.com' },
    { APP_URL: 'https://example.com/path' },
  ]) {
    const result = scenario(overrides);
    assert.equal(result.status, 1);
    assert.deepEqual(result.calls, []);
  }
});

test('missing placement schema or bank blocks production publication', () => {
  const result = scenario({ TEST_PLACEMENT_FAIL: '1' });
  assert.equal(result.status, 1);
  assert.deepEqual(
    result.calls.map((call) => call.script),
    ['db:check', 'placement:check'],
  );
});

test('learning readiness failure blocks publication', () => {
  const r = scenario({ TEST_LEARNING_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /learning:check failed/);
  assert.equal(
    r.calls.some((c) => c.script === 'build:cloudflare'),
    false,
  );
});

test('exercise engine readiness failure blocks publication', () => {
  const r = scenario({ TEST_EXERCISES_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /exercises:check failed/);
  assert.equal(
    r.calls.some((c) => c.script === 'build:cloudflare'),
    false,
  );
});

test('missing curriculum package blocks publication', () => {
  const r = scenario({ TEST_LIBRARY_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /library:db-check failed/);
  assert.equal(
    r.calls.some((c) => c.script === 'build:cloudflare'),
    false,
  );
});

test('missing or unsafe premium permissions block publication', () => {
  const r = scenario({ TEST_PREMIUM_FAIL: '1' });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /premium:check failed/);
  assert.equal(
    r.calls.some((c) => c.script === 'build:cloudflare'),
    false,
  );
});
