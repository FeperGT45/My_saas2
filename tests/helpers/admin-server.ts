// Isolated HTTPS PostgREST fixture + the real production Next server. No auth bypass in app code.
import { createServer } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
export async function adminServer() {
  const db = new PGlite(),
    dir = await mkdtemp(join(tmpdir(), 'voklumi-admin-'));
  const admin = 'a0000000-0000-0000-0000-000000000001',
    student = 'a0000000-0000-0000-0000-000000000002';
  const tokens = {
    admin: 'a'.repeat(64),
    student: 'b'.repeat(64),
    expired: 'c'.repeat(64),
  };
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;`,
  );
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [admin, student]);
  await db.query(
    "INSERT INTO public.users(id,display_name,telegram_id) VALUES($1,'Owner',123),($2,'Student',456)",
    [admin, student],
  );
  for (const [i, key] of Object.keys(tokens).entries())
    await db.query(
      "INSERT INTO public.telegram_sessions(token_hash,init_hash,user_id,created_at,expires_at) VALUES($1,$2,$3,now()-interval '2 days',now()+($4::int)*interval '1 day')",
      [
        hash(tokens[key as keyof typeof tokens]),
        String(i + 1).repeat(64),
        key === 'student' ? student : admin,
        key === 'expired' ? -1 : 1,
      ],
    );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const backend = createServer(
    {
      key: await readFile(join(dir, 'key.pem')),
      cert: await readFile(join(dir, 'cert.pem')),
    },
    async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.apikey !== 'test-service-key') {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      try {
        const url = new URL(req.url!, 'https://fixture.test');
        let data: unknown;
        if (url.pathname === '/rest/v1/telegram_sessions')
          data =
            (
              await db.query(
                'SELECT user_id FROM public.telegram_sessions WHERE token_hash=$1 AND expires_at>now()',
                [url.searchParams.get('token_hash')?.slice(3)],
              )
            ).rows[0] ?? null;
        else if (url.pathname === '/rest/v1/users')
          data =
            (
              await db.query(
                'SELECT id,display_name,avatar_url,telegram_id FROM public.users WHERE id=$1',
                [url.searchParams.get('id')?.slice(3)],
              )
            ).rows[0] ?? null;
        else if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const b = JSON.parse(Buffer.concat(chunks).toString());
          if (url.pathname === '/rest/v1/rpc/admin_read')
            data = (
              await db.query<{ data: unknown }>(
                'SELECT public.admin_read($1,$2,$3,$4) AS data',
                [b.p_view, b.p_parent, b.p_search, b.p_offset],
              )
            ).rows[0].data;
          else if (url.pathname === '/rest/v1/rpc/admin_save_content')
            data = (
              await db.query<{ data: unknown }>(
                'SELECT public.admin_save_content($1,$2,$3,$4::jsonb,$5) AS data',
                [
                  b.p_actor,
                  b.p_request,
                  b.p_entity,
                  JSON.stringify(b.p_data),
                  b.p_confirmation,
                ],
              )
            ).rows[0].data;
          else throw new Error('unsupported fixture RPC');
        } else throw new Error('unsupported fixture path');
        res.end(JSON.stringify(data));
      } catch (error) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            message: (error as Error).message,
            code: (error as { code?: string }).code ?? 'TEST',
          }),
        );
      }
    },
  );
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const backendPort = (backend.address() as { port: number }).port;
  const socket = createTcpServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem'),
        NEXT_PUBLIC_SUPABASE_URL: `https://127.0.0.1:${backendPort}`,
        SUPABASE_SECRET_KEY: 'test-service-key',
        ADMIN_USER_IDS: admin,
        APP_URL: origin,
        TELEGRAM_STARS_PAYMENTS_ENABLED: 'false',
        TELEGRAM_STARS_OWNER_REVIEWED: 'false',
      },
      stdio: 'ignore',
    },
  );
  async function close() {
    child.kill('SIGTERM');
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${origin}/api/health`);
      if (r.ok) return { origin, db, tokens, admin, student, close };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await close();
  throw new Error('Isolated admin server failed to start.');
}
