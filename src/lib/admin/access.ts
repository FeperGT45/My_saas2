import type { SessionUser } from '@/lib/auth/session';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
/** Fail closed: no client role, username, Telegram ID or demo identity can grant access. */
export function isAdmin(
  user: SessionUser | null,
  configured: string | undefined,
): boolean {
  if (!user || user.mode !== 'telegram' || !uuid.test(user.id) || !configured)
    return false;
  const ids = configured.split(',').map((id) => id.trim().toLowerCase());
  return (
    ids.length <= 100 &&
    ids.every((id) => uuid.test(id)) &&
    ids.includes(user.id.toLowerCase())
  );
}
