import { lessonRequest, json } from '@/lib/lessons/http';
import { billingConfiguration } from '@/lib/billing/config';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    const { data, error } = await db.rpc('premium_status', { p_user: userId });
    return error
      ? json({ error: 'Статус Premium недоступен.' }, 503)
      : json({ ...data, ...billingConfiguration(process.env) });
  });
}
