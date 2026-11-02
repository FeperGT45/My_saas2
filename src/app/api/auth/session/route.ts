import { getSessionUser } from '@/lib/auth/session';
export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    return Response.json(
      { user },
      { status: user ? 200 : 401, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'Session unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
