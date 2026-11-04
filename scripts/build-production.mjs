// Runs inside the hosting build environment. Never logs credentials or upstream errors.
import { spawn } from 'node:child_process';
const required = [
  'APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
];
const missing = required.filter((key) => !process.env[key]?.trim());
async function run(script, env = process.env) {
  const code = await new Promise((resolve, reject) => {
    const child = env.npm_execpath
      ? spawn(process.execPath, [env.npm_execpath, 'run', script], {
          stdio: 'inherit',
          env,
        })
      : spawn('npm', ['run', script], { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(`${script} failed; publication blocked.`);
}
try {
  if (missing.length)
    throw new Error(`Configure build variables/secrets: ${missing.join(', ')}`);
  const origin = new URL(process.env.APP_URL);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  )
    throw new Error('APP_URL must be a public HTTPS origin.');
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET))
    throw new Error(
      'TELEGRAM_WEBHOOK_SECRET must contain 32–256 safe characters.',
    );
  let username;
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
      { signal: AbortSignal.timeout(10000) },
    );
    const body = await response.json();
    if (
      !response.ok ||
      !body.ok ||
      !body.result?.is_bot ||
      !/^[a-zA-Z0-9_]{5,32}$/.test(body.result.username)
    )
      throw new Error();
    username = body.result.username;
  } catch {
    throw new Error(
      'Telegram getMe failed. Check the build secret and Bot API connectivity. Details redacted.',
    );
  }
  console.log(`Verified Telegram bot: @${username}`);
  // Resolve username from the authenticated Bot API, rather than trusting a placeholder.
  const env = { ...process.env, TELEGRAM_BOT_USERNAME: username };
  await run('db:check', env);
  await run('placement:check', env);
  await run('learning:check', env);
  await run('exercises:check', env);
  await run('library:db-check', env);
  await run('premium:check', env);
  await run('weekly:check', env);
  await run('analytics:check', env);
  await run('dictionary:check', env);
  await run('stories:check', env);
  await run('weak:check', env);
  await run('challenges:check', env);
  await run('premium:expansion-check', env);
  await run('build:cloudflare', env);
} catch (error) {
  console.error(
    error instanceof Error &&
      !missing.length &&
      error.message.startsWith('fetch')
      ? 'Production preflight failed. Details redacted.'
      : error.message,
  );
  process.exitCode = 1;
}
