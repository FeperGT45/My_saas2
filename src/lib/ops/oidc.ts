const issuer = 'https://token.actions.githubusercontent.com';
export const monitorRepository = 'FeperGT45/My_saas2';
export const monitorWorkflow = `${monitorRepository}/.github/workflows/monitor.yml@refs/heads/main`;
let cached: { expires: number; keys: JsonWebKey[] } | null = null;
const decode = (part: string) =>
  Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
/** Only the default-branch monitoring workflow may call the machine endpoint. */
export async function verifyMonitorToken(
  token: string,
  audience: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  try {
    if (token.length > 16000) return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
      return false;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))),
      claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const seconds = now / 1000;
    if (
      header.alg !== 'RS256' ||
      header.typ !== 'JWT' ||
      typeof header.kid !== 'string' ||
      header.kid.length > 256 ||
      claims.iss !== issuer ||
      claims.aud !== audience ||
      claims.repository !== monitorRepository ||
      claims.repository_id !== '1442604815' ||
      claims.repository_owner_id !== '350034881' ||
      claims.workflow_ref !== monitorWorkflow ||
      claims.ref !== 'refs/heads/main' ||
      !['schedule', 'workflow_dispatch', 'push'].includes(claims.event_name) ||
      ![claims.exp, claims.iat, claims.nbf].every(Number.isFinite) ||
      claims.exp <= seconds ||
      claims.nbf > seconds + 30 ||
      claims.iat > seconds + 30 ||
      claims.iat < seconds - 600 ||
      claims.exp - claims.iat > 600
    )
      return false;
    let keys = cached;
    if (!keys || keys.expires <= now) {
      const r = await fetcher(`${issuer}/.well-known/jwks`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return false;
      const body = await r.json();
      if (!Array.isArray(body.keys) || body.keys.length > 30) return false;
      keys = { expires: now + 300000, keys: body.keys };
      cached = keys;
    }
    const jwk = keys.keys.find(
      (k) =>
        (k as JsonWebKey & { kid: string }).kid === header.kid &&
        k.kty === 'RSA' &&
        k.alg === 'RS256' &&
        k.use === 'sig',
    );
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}
