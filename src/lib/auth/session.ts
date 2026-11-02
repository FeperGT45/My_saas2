import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import type { TelegramIdentity } from '@/lib/telegram/validate';
import { localAuthAllowed, validLocalSession } from './security';
export const sessionCookie =
  process.env.NODE_ENV === 'production'
    ? '__Host-voklumi_session'
    : 'voklumi_session';
export const localCookie = 'voklumi_local';
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 86400,
};
export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server database unavailable');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export type SessionUser = {
  id: string;
  name: string;
  avatarUrl: string | null;
  telegramId: string | null;
  mode: 'telegram' | 'local';
};
export async function getSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const jar = await cookies();
  if (
    localAuthAllowed(request) &&
    process.env.LOCAL_AUTH_SECRET &&
    validLocalSession(
      jar.get(localCookie)?.value ?? '',
      process.env.LOCAL_AUTH_SECRET,
    )
  )
    return {
      id: 'local-demo',
      name: 'Исследователь',
      avatarUrl: null,
      telegramId: null,
      mode: 'local',
    };
  const token = jar.get(sessionCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const db = adminClient();
  const { data, error } = await db
    .from('telegram_sessions')
    .select('user_id')
    .eq('token_hash', hashToken(token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error('Session lookup failed');
  if (!data) return null;
  const profile = await db
    .from('users')
    .select('id,display_name,avatar_url,telegram_id')
    .eq('id', data.user_id)
    .single();
  if (profile.error) throw new Error('Profile unavailable');
  return {
    id: profile.data.id,
    name: profile.data.display_name,
    avatarUrl: profile.data.avatar_url,
    telegramId: String(profile.data.telegram_id),
    mode: 'telegram',
  };
}
export async function createTelegramSession(
  user: TelegramIdentity,
  raw: string,
) {
  const db = adminClient();
  const token = randomBytes(32).toString('hex');
  const found = await db
    .from('users')
    .select('id')
    .eq('telegram_id', user.id)
    .maybeSingle();
  if (found.error) throw new Error('Profile lookup failed');
  let authId = found.data?.id as string | undefined;
  let created = false;
  if (!authId) {
    // No Telegram ID/email linking from browser; random internal identity has no usable password.
    const result = await db.auth.admin.createUser({
      email: `${randomUUID()}@telegram.voklumi.invalid`,
      email_confirm: true,
      app_metadata: { provider_source: 'telegram' },
    });
    if (result.error || !result.data.user)
      throw new Error('Identity creation failed');
    authId = result.data.user.id;
    created = true;
  }
  const result = await db.rpc('create_telegram_session', {
    p_auth_id: authId,
    p_telegram_id: user.id,
    p_name: [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .slice(0, 80),
    p_username: user.username ?? null,
    p_avatar: user.photoUrl ?? null,
    p_token_hash: hashToken(token),
    p_init_hash: new URLSearchParams(raw).get('hash')!.toLowerCase(),
  });
  // Concurrent first login may resolve to another identity; remove only our newly created orphan.
  if (created && (result.error || result.data !== authId))
    await db.auth.admin.deleteUser(authId);
  if (result.error)
    throw new Error('Session creation failed or initData already used');
  return token;
}
