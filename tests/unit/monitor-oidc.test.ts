import { beforeEach, it, expect, vi } from 'vitest';
const encoder = new TextEncoder(),
  audience = 'https://example.com/api/ops/check';
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
let key: CryptoKeyPair,
  jwk: JsonWebKey,
  verify: typeof import('@/lib/ops/oidc').verifyMonitorToken;
const now = Date.now(),
  seconds = Math.floor(now / 1000);
const claims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: audience,
  repository: 'FeperGT45/My_saas2',
  repository_id: '1442604815',
  repository_owner_id: '350034881',
  workflow_ref:
    'FeperGT45/My_saas2/.github/workflows/monitor.yml@refs/heads/main',
  ref: 'refs/heads/main',
  event_name: 'schedule',
  iat: seconds,
  nbf: seconds - 1,
  exp: seconds + 300,
};
beforeEach(async () => {
  vi.resetModules();
  verify = (await import('@/lib/ops/oidc')).verifyMonitorToken;
  key = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  jwk = {
    ...(await crypto.subtle.exportKey('jwk', key.publicKey)),
    alg: 'RS256',
    use: 'sig',
    ...{ kid: 'fixture-key' },
  };
});
async function token(patch: object = {}, header: object = {}) {
  const text =
    encode({ alg: 'RS256', typ: 'JWT', kid: 'fixture-key', ...header }) +
    '.' +
    encode({ ...claims, ...patch });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    encoder.encode(text),
  );
  return text + '.' + Buffer.from(signature).toString('base64url');
}
const fetchKeys = () => Promise.resolve(Response.json({ keys: [jwk] }));
it('accepts a real RS256 signature only for the monitoring workflow and expected audience', async () => {
  expect(await verify(await token(), audience, fetchKeys, now)).toBe(true);
  expect(await verify(await token(), audience + '/wrong', fetchKeys, now)).toBe(
    false,
  );
});
it('rejects fork, different workflow/branch, PR, owner transfer, expired or future tokens', async () => {
  for (const patch of [
    { repository: 'attacker/fork' },
    { repository_id: '1' },
    { repository_owner_id: '1' },
    {
      workflow_ref:
        'FeperGT45/My_saas2/.github/workflows/other.yml@refs/heads/main',
    },
    { ref: 'refs/heads/evil' },
    { event_name: 'pull_request_target' },
    { exp: seconds - 1 },
    { nbf: seconds + 100 },
    { iat: seconds - 700 },
    { exp: seconds + 3600 },
  ])
    expect(
      await verify(await token(patch), audience, fetchKeys, now),
      JSON.stringify(patch),
    ).toBe(false);
});
it('fails closed on algorithm confusion, malformed data, tampered signature and unavailable keys', async () => {
  expect(
    await verify(await token({}, { alg: 'none' }), audience, fetchKeys, now),
  ).toBe(false);
  const valid = await token();
  const parts = valid.split('.');
  parts[1] = encode({ ...claims, event_name: 'push' });
  expect(await verify(parts.join('.'), audience, fetchKeys, now)).toBe(false);
  for (const invalid of ['bad', '.'.repeat(4), 'a'.repeat(17000)])
    expect(await verify(invalid, audience, fetchKeys, now)).toBe(false);
  vi.resetModules();
  verify = (await import('@/lib/ops/oidc')).verifyMonitorToken;
  expect(
    await verify(
      valid,
      audience,
      async () => {
        throw Error('private network diagnostic');
      },
      now,
    ),
  ).toBe(false);
});
