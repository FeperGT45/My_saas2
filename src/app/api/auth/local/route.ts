import { cookies } from 'next/headers';
import {
  assertSameOrigin,
  equalSecret,
  localAuthAllowed,
  signLocalSession,
} from '@/lib/auth/security';
import { localCookie } from '@/lib/auth/session';
export async function POST(request: Request) {
  if (!localAuthAllowed(request)) return new Response(null, { status: 404 });
  try {
    assertSameOrigin(request);
  } catch {
    return new Response(null, { status: 403 });
  }
  const secret = process.env.LOCAL_AUTH_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    !equalSecret(request.headers.get('x-local-auth-secret') ?? '', secret)
  )
    return new Response(null, { status: 401 });
  (await cookies()).set(
    localCookie,
    signLocalSession(secret, Date.now() + 3600000),
    {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/',
      maxAge: 3600,
    },
  );
  return Response.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
