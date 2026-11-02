import { readBodyText } from '@/lib/auth/body';
import { cookies } from 'next/headers';
import { validateInitData } from '@/lib/telegram/validate';
import { assertSameOrigin } from '@/lib/auth/security';
import {
  createTelegramSession,
  getSessionUser,
  sessionCookie,
  cookieOptions,
} from '@/lib/auth/session';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  )
    return Response.json(
      { error: 'Telegram sign-in is not configured' },
      { status: 503 },
    );
  let raw: string;
  try {
    if (Number(request.headers.get('content-length')) > 20000)
      throw new Error();
    const body = await readBodyText(request, 20000);
    if (body.length > 20000) throw new Error();
    const payload = JSON.parse(body);
    if (
      typeof payload.initData !== 'string' ||
      Object.keys(payload).some((k) => k !== 'initData')
    )
      throw new Error();
    raw = payload.initData;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  let user;
  try {
    user = validateInitData(raw, process.env.TELEGRAM_BOT_TOKEN);
  } catch {
    return Response.json(
      { error: 'Invalid or expired Telegram data' },
      { status: 401 },
    );
  }
  try {
    const existing = await getSessionUser(request);
    if (
      existing?.mode === 'telegram' &&
      existing.telegramId === String(user.id)
    )
      return Response.json(
        { user: existing },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    const token = await createTelegramSession(user, raw);
    const jar = await cookies();
    jar.set(sessionCookie, token, cookieOptions);
    return Response.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Unable to sign in. Reopen the Mini App.' },
      { status: 503 },
    );
  }
}
