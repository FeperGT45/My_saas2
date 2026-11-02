// Bootstrap a new Worker without writing credentials into the repository or command arguments.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const required = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'SUPABASE_SECRET_KEY',
];
const optional = ['ADMIN_USER_IDS', 'SUPABASE_HEALTHCHECK_SECRET'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(
    `Deployment not started. Configure runtime Secrets: ${missing.join(', ')}.`,
  );
  process.exitCode = 2;
} else {
  let directory;
  try {
    directory = await mkdtemp(join(tmpdir(), 'voklumi-deploy-'));
    const filename = join(directory, 'secrets.json');
    const secrets = Object.fromEntries(
      [...required, ...optional]
        .filter((name) => process.env[name])
        .map((name) => [name, process.env[name]]),
    );
    await writeFile(filename, JSON.stringify(secrets), { mode: 0o600 });
    const cli = fileURLToPath(
      new URL('../node_modules/cf/bin/cf', import.meta.url),
    );
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          'deploy',
          '--prebuilt',
          '--mode',
          'production',
          '--secrets-file',
          filename,
        ],
        { stdio: 'inherit', env: process.env },
      );
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } catch {
    console.error(
      'Deployment stopped. Check Cloudflare access and runtime configuration.',
    );
    process.exitCode = 1;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
