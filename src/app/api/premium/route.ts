import { lessonRequest, json } from '@/lib/lessons/http';
import { billingConfiguration } from '@/lib/billing/config';
import { premiumStatus } from '@/lib/premium/server';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    if (new URL(request.url).search)
      return json({ error: 'Некорректные параметры.' }, 400);
    return json({
      ...(await premiumStatus(userId, db)),
      ...billingConfiguration(process.env),
    });
  });
}
