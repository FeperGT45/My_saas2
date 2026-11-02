import { createHmac, timingSafeEqual } from 'node:crypto';
export type TelegramIdentity = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  referralCode?: string;
};
export function validateInitData(
  raw: string,
  token: string,
  now = Math.floor(Date.now() / 1000),
): TelegramIdentity {
  if (!token || !raw || Buffer.byteLength(raw) > 16384)
    throw new Error('Invalid Telegram data');
  const params = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key)) throw new Error('Duplicate field');
    seen.add(key);
  }
  const hash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid signature');
  const text = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(text).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex')))
    throw new Error('Invalid signature');
  const date = params.get('auth_date') ?? '';
  if (
    !/^\d+$/.test(date) ||
    !Number.isSafeInteger(Number(date)) ||
    Number(date) > now + 30 ||
    now - Number(date) > 300
  )
    throw new Error('Expired Telegram data');
  const user: unknown = JSON.parse(params.get('user') ?? 'null');
  if (
    !user ||
    typeof user !== 'object' ||
    !('id' in user) ||
    !Number.isSafeInteger(user.id) ||
    Number(user.id) <= 0 ||
    !('first_name' in user) ||
    typeof user.first_name !== 'string' ||
    !user.first_name.trim()
  )
    throw new Error('Invalid Telegram user');
  const value = user as Record<string, unknown>;
  let photoUrl: string | undefined;
  if (typeof value.photo_url === 'string') {
    const url = new URL(value.photo_url);
    if (url.protocol === 'https:' && !url.username && !url.password)
      photoUrl = url.href;
  }
  return {
    referralCode: /^r_[a-f0-9]{32}$/.test(params.get('start_param') ?? '')
      ? params.get('start_param')!.slice(2)
      : undefined,
    id: Number(user.id),
    firstName: user.first_name.slice(0, 80),
    lastName:
      typeof value.last_name === 'string'
        ? value.last_name.slice(0, 80)
        : undefined,
    username:
      typeof value.username === 'string'
        ? value.username.slice(0, 64)
        : undefined,
    photoUrl,
  };
}
