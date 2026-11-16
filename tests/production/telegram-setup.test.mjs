import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
function scenario({ name = 'Voklumi', badWebhook = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'voklumi-bot-setup-'));
  try {
    const log = join(directory, 'calls.jsonl'),
      preload = join(directory, 'fetch.mjs');
    writeFileSync(
      preload,
      `import {appendFileSync} from 'node:fs';
let commands=[],webhook;
globalThis.fetch=async(input,init)=>{
 const method=new URL(input).pathname.split('/').pop(); const body=JSON.parse(init.body);
 appendFileSync(process.env.TEST_LOG,JSON.stringify({method,body})+'\\n');
 let result=true;
 if(method==='getMyName') result={name:process.env.TEST_NAME};
 if(method==='getMyCommands') result=commands;
 if(method==='setMyCommands') commands=body.commands;
 if(method==='getChatMenuButton') result={type:'web_app',text:'Открыть Voklumi',web_app:{url:'https://example.com/'}};
 if(method==='setWebhook') webhook=body;
 if(method==='getWebhookInfo') result={url:webhook.url,allowed_updates:process.env.TEST_BAD_WEBHOOK?['message']:webhook.allowed_updates};
 return {ok:true,json:async()=>({ok:true,result})};
};`,
    );
    const r = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        resolve('scripts/setup-telegram.mjs'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_URL: 'https://example.com/',
          TELEGRAM_BOT_TOKEN: 'fixture-do-not-log',
          TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
          TEST_LOG: log,
          TEST_NAME: name,
          TEST_BAD_WEBHOOK: badWebhook ? '1' : '',
        },
      },
    );
    assert.ok(!(r.stdout + r.stderr).includes('fixture-do-not-log'));
    return {
      status: r.status,
      calls: readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test('setup skips unchanged bot name/menu and enables and verifies ticket callbacks', () => {
  const { status, calls } = scenario();
  assert.equal(status, 0);
  assert.ok(
    !calls.some((c) => ['setMyName', 'setChatMenuButton'].includes(c.method)),
  );
  const webhook = calls.find((c) => c.method === 'setWebhook').body;
  assert.deepEqual(webhook.allowed_updates, [
    'message',
    'pre_checkout_query',
    'callback_query',
  ]);
  assert.equal(webhook.drop_pending_updates, false);
  const commands = calls.find((c) => c.method === 'setMyCommands').body
    .commands;
  assert.ok(commands.some((c) => c.command === 'tickets'));
  assert.ok(commands.some((c) => c.command === 'cancel'));
});
test('setup still configures a new bot name', () => {
  const { status, calls } = scenario({ name: 'Other' });
  assert.equal(status, 0);
  assert.deepEqual(calls.find((c) => c.method === 'setMyName').body, {
    name: 'Voklumi',
  });
});
test('setup refuses to report success when callback webhook updates are missing', () => {
  assert.equal(scenario({ badWebhook: true }).status, 1);
});
