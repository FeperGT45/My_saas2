import { createHmac, timingSafeEqual } from 'node:crypto';
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function assertSameOrigin(request: Request) {
  const expected =
    process.env.APP_URL ||
    (process.env.NODE_ENV === 'development' ? new URL(request.url).origin : '');
  if (!expected || request.headers.get('origin') !== new URL(expected).origin)
    throw new Error('Forbidden origin');
}
export function localAuthAllowed(request: Request) {
  const host = new URL(request.url).hostname;
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.ENABLE_LOCAL_AUTH === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(host)
  );
}
export function signLocalSession(secret: string, expires: number) {
  return `${expires}.${createHmac('sha256', secret).update(`voklumi-local:${expires}`).digest('hex')}`;
}
export function validLocalSession(
  value: string,
  secret: string,
  now = Date.now(),
) {
  const [expires] = value.split('.');
  const n = Number(expires);
  return (
    /^\d+$/.test(expires) &&
    n > now &&
    n <= now + 3600000 &&
    equalSecret(value, signLocalSession(secret, n))
  );
}
