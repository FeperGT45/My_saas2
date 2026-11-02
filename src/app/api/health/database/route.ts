import { createServiceClient } from '@/lib/supabase/service';
import { isDatabaseReady } from '@/lib/supabase/readiness';
import { equalSecret } from '@/lib/auth/security';
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: Request) {
  const secret = process.env.SUPABASE_HEALTHCHECK_SECRET;
  if (!secret || secret.length < 32) return new Response(null, { status: 404 });
  if (
    !equalSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)
  )
    return new Response(null, { status: 401 });
  try {
    const { data, error } = await createServiceClient().rpc(
      'voklumi_database_status',
    );
    if (error || !isDatabaseReady(data))
      return json({ status: 'unavailable' }, 503);
    return json({ status: 'ok', schemaVersion: data.schemaVersion }, 200);
  } catch {
    return json({ status: 'unavailable' }, 503);
  }
}
