import { cookies } from 'next/headers';
import { assertSameOrigin } from '@/lib/auth/security';
import {
  adminClient,
  hashToken,
  localCookie,
  sessionCookie,
  cookieOptions,
} from '@/lib/auth/session';
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return new Response(null, { status: 403 });
  }
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  if (token) {
    try {
      const result = await adminClient()
        .from('telegram_sessions')
        .delete()
        .eq('token_hash', hashToken(token));
      if (result.error) throw new Error();
    } catch {
      return Response.json(
        { error: 'Unable to revoke session' },
        { status: 503 },
      );
    }
  }
  jar.set(sessionCookie, '', { ...cookieOptions, maxAge: 0 });
  jar.delete(localCookie);
  return Response.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
