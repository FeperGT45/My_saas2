import { verifyMonitorToken } from '@/lib/ops/oidc';
import { checkOperations } from '@/lib/ops/check';
import { json } from '@/lib/lessons/http';
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer '))
    return json({ error: 'Unauthorized' }, 401);
  let audience: string;
  try {
    audience = new URL('/api/ops/check', process.env.APP_URL).href;
  } catch {
    return json({ error: 'Monitor unavailable' }, 503);
  }
  if (
    !authorization.startsWith('Bearer ') ||
    !(await verifyMonitorToken(authorization.slice(7), audience))
  )
    return json({ error: 'Unauthorized' }, 401);
  try {
    const result = await checkOperations();
    return json(result, result.status === 'ok' ? 200 : 503);
  } catch {
    return json(
      {
        status: 'unavailable',
        error: 'Monitoring or alert delivery unavailable',
      },
      503,
    );
  }
}
