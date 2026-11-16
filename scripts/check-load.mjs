// Bounded public reads only: no session, writes, users or payments.
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
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
const stages = [];
const workloads = [1, 4, 8].map((concurrency) => ({
  concurrency,
  count: 24,
  soak: false,
}));
if (process.argv.includes('--soak'))
  workloads.push({ concurrency: 8, count: 480, soak: true });
for (const { concurrency, count, soak } of workloads) {
  const stageStart = performance.now();
  const deadline = soak ? stageStart + 60000 : Infinity;
  const timings = [];
  let next = 0,
    bytes = 0,
    failed = false;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (!failed && performance.now() < deadline && next++ < count) {
        const start = performance.now();
        try {
          const r = await fetch(new URL('/api/library', origin), {
            signal: AbortSignal.timeout(15000),
          });
          assert.equal(
            r.status,
            200,
            'Stop on HTTP failure, including rate limiting',
          );
          const body = await r.text();
          assert(
            !/answer_key|reference_answer|token_hash|service_role/.test(body),
          );
          assert(JSON.parse(body).flatMap((c) => c.lessons).length >= 301);
          bytes += Buffer.byteLength(body);
          timings.push(Math.round(performance.now() - start));
          if (soak) await pause(500);
        } catch {
          failed = true;
        }
      }
    }),
  );
  timings.sort((a, b) => a - b);
  const percentile = (p) =>
    timings[Math.max(0, Math.ceil(timings.length * p) - 1)] ?? null;
  stages.push({
    concurrency,
    soak,
    elapsedMs: Math.round(performance.now() - stageStart),
    completed: timings.length,
    failed,
    bytes,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: timings.at(-1) ?? null,
  });
  if (failed) break;
}
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      stages,
      limits:
        'Bounded public catalog reads; optional 60-second/480-request soak. No authenticated concurrency, capacity guarantee or physical device coverage.',
    },
    null,
    2,
  ),
);
if (stages.some((s) => s.failed)) process.exitCode = 1;
