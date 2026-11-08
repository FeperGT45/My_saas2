import { describe, it, expect } from 'vitest';
import {
  sessionCookieNames,
  sessionCookieOptions,
} from '@/lib/auth/cookie-policy';
import { matchesLaunchAccount } from '@/features/telegram/session-resume';
describe('Telegram embedded session security', () => {
  it('production session can be sent in a secure cross-site iframe and stays partitioned and HttpOnly', () => {
    const p = sessionCookieOptions(true);
    expect(p).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'none',
      partitioned: true,
      path: '/',
      maxAge: 86400,
    });
    expect(p).not.toHaveProperty('domain');
    expect(sessionCookieNames(true)).toEqual({
      name: '__Host-voklumi_session_v2',
      legacy: '__Host-voklumi_session',
    });
  });
  it('local development does not set an unusable Secure/None cookie over HTTP', () => {
    expect(sessionCookieOptions(false)).toMatchObject({
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
    });
    expect(sessionCookieOptions(false)).not.toHaveProperty('partitioned');
  });
  it('resumes only the matching server-verified Telegram account, independently of initData age', () => {
    const account = { mode: 'telegram', telegramId: '456' };
    const raw = new URLSearchParams({
      auth_date: '1',
      user: JSON.stringify({ id: 456 }),
    }).toString();
    expect(matchesLaunchAccount(account, raw)).toBe(true);
    for (const user of [{ id: 789 }, { id: '456' }, { id: -1 }, null])
      expect(
        matchesLaunchAccount(
          account,
          new URLSearchParams({ user: JSON.stringify(user) }).toString(),
        ),
      ).toBe(false);
    for (const raw of ['', 'user=%7Bbroken', 'user=null'])
      expect(matchesLaunchAccount(account, raw)).toBe(false);
    expect(matchesLaunchAccount(null, raw)).toBe(false);
    expect(
      matchesLaunchAccount({ mode: 'local', telegramId: '456' }, raw),
    ).toBe(false);
  });
});
