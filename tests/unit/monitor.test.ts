import { it, expect, vi } from 'vitest';
import { probe, reconcileIssue } from '../../scripts/monitor.mjs';
const failed = [{ path: '/api/health', status: 503, ok: false }],
  good = [{ path: '/api/health', status: 200, ok: true }];
const incident = {
  number: 1,
  state: 'open',
  user: { login: 'github-actions[bot]' },
  body: '<!-- voklumi-availability-monitor:v1 -->',
};
it('checks public app and authenticated operations without following redirects', async () => {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      const url = String(input);
      if (url.endsWith('/api/library'))
        return Response.json([{ lessons: [{ title: 'Safe' }] }]);
      if (url.endsWith('/api/ops/check'))
        expect(init?.headers).toEqual({ Authorization: 'Bearer fake-oidc' });
      return Response.json({ status: 'ok' });
    },
  );
  expect((await probe(fetcher, 'fake-oidc')).every((r) => r.ok)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('reports invalid data, network/HTTP failures without logging private upstream diagnostics', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/api/health')) throw Error('secret-upstream');
    return Response.json({}, { status: 503 });
  });
  const result = await probe(fetcher, 'private-token');
  expect(result.every((r) => !r.ok)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/secret|private-token/);
});
it('opens one bot incident, does not spam while open, and closes/reopens on state changes', async () => {
  let rows: object[] = [];
  const api = vi.fn(async (method: string, _path: string, body?: unknown) =>
    method === 'GET' ? rows : body,
  );
  await reconcileIssue(api, failed, 'https://github.com/test/run');
  expect(api.mock.calls.some((c) => c[0] === 'POST')).toBe(true);
  rows = [incident];
  api.mockClear();
  await reconcileIssue(api, failed, 'https://github.com/test/run');
  expect(api).toHaveBeenCalledTimes(1);
  api.mockClear();
  await reconcileIssue(api, good, 'https://github.com/test/run');
  expect(api.mock.calls[1][2]).toEqual({
    state: 'closed',
    state_reason: 'completed',
  });
  rows = [{ ...incident, state: 'closed' }];
  api.mockClear();
  await reconcileIssue(api, failed, 'https://github.com/test/run');
  expect(api.mock.calls[1][2]).toMatchObject({ state: 'open' });
});
it('never edits an issue created by another person, even with a copied marker', async () => {
  const api = vi.fn(async (method: string) =>
    method === 'GET' ? [{ ...incident, user: { login: 'human' } }] : {},
  );
  await reconcileIssue(api, failed, 'https://github.com/test/run');
  expect(api.mock.calls.map((c) => c[0])).toEqual(['GET', 'POST']);
});

it('logs only allowlisted boolean checks when operations are degraded', async () => {
  const fetcher = async (input: RequestInfo | URL) =>
    new Response(
      JSON.stringify(
        String(input).endsWith('/api/ops/check')
          ? {
              checks: {
                database: true,
                webhook: false,
                support: true,
                privateText: 'secret',
                billing: 'token',
              },
              secret: 'never-log',
            }
          : { status: 'ok' },
      ),
      { status: String(input).endsWith('/api/ops/check') ? 503 : 200 },
    );
  const results = await probe(fetcher, 'fake-oidc');
  expect(results[1]).toEqual({
    path: '/api/ops/check',
    status: 503,
    ok: false,
    checks: { database: true, webhook: false, support: true },
  });
  expect(JSON.stringify(results)).not.toContain('secret');
});
