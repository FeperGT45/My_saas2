// Read-only release smoke/load check. Never uses a session or creates test users in production.
import assert from 'node:assert/strict';
const origin = new URL(
  process.env.RELEASE_APP_URL ?? 'https://voklumi.voklumi67.workers.dev',
);
assert(
  origin.protocol === 'https:' &&
    !origin.username &&
    !origin.password &&
    !origin.search &&
    !origin.hash &&
    origin.pathname === '/',
);
const results = [];
async function read(path, expected, method = 'GET') {
  const start = performance.now(),
    r = await fetch(new URL(path, origin), {
      method,
      ...(method === 'POST'
        ? {
            headers: {
              Origin: origin.origin,
              'Content-Type': 'application/json',
            },
            body: '{}',
          }
        : {}),
      signal: AbortSignal.timeout(15000),
    }),
    text = await r.text();
  assert.equal(r.status, expected, path);
  results.push({
    path,
    method,
    status: r.status,
    ms: Math.round(performance.now() - start),
  });
  return text;
}
await read('/api/health', 200);
const body = await read('/api/library', 200),
  courses = JSON.parse(body),
  lessons = courses.flatMap((c) => c.lessons);
assert(lessons.length >= 301);
assert(
  !/answer_key|reference_answer|incorrect_answer|token_hash|service_role/.test(
    body,
  ),
);
const terms = await read('/premium/terms', 200);
assert(
  terms.includes('49') &&
    terms.includes('149') &&
    terms.includes('https://t.me/feper145'),
);
for (const path of [
  '/api/auth/session',
  '/api/overview',
  '/api/premium',
  '/api/premium/features',
  '/api/learning-plan',
  '/api/analytics',
  '/api/dictionary',
  '/api/stories',
  '/api/weak-training',
  '/api/challenges',
  '/api/extended-test',
  '/api/appearance',
])
  await read(path, 401);
await read('/api/weekly-plan', 401, 'POST');
const checkout = await fetch(new URL('/api/premium/invoice', origin), {
  method: 'POST',
  headers: { Origin: origin.origin, 'Content-Type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(15000),
});
assert.equal(checkout.status, 503, 'Live checkout must remain disabled');
await checkout.body?.cancel();
const timings = [];
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next++ < 20) {
      const start = performance.now(),
        r = await fetch(new URL('/api/library', origin), {
          signal: AbortSignal.timeout(15000),
        });
      assert.equal(r.status, 200);
      const data = await r.json();
      assert.equal(data.flatMap((c) => c.lessons).length, lessons.length);
      timings.push(Math.round(performance.now() - start));
    }
  }),
);
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      origin: origin.origin,
      courses: courses.length,
      lessons: lessons.length,
      checks: results,
      checkoutDisabled: true,
      readLoad: {
        requests: 20,
        concurrency: 4,
        p50Ms: timings[9],
        p95Ms: timings[18],
        maxMs: timings.at(-1),
      },
      limits:
        'Small read-only smoke load, not a capacity guarantee or authenticated multi-user load test.',
    },
    null,
    2,
  ),
);
