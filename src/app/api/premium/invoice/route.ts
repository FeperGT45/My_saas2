import { lessonRequest, json, isUuid } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { billingConfiguration, invoiceParameters } from '@/lib/billing/config';
import { telegramCall } from '@/lib/billing/telegram';
export async function POST(request: Request) {
  const config = billingConfiguration(process.env);
  if (!config.enabled)
    return json(
      { error: 'Платежи выключены. Владелец ещё не подтвердил запуск.' },
      503,
    );
  return lessonRequest(request, true, async (userId, db) => {
    let body;
    try {
      body = JSON.parse(await readBodyText(request, 1024));
    } catch {
      return json({ error: 'Некорректный запрос.' }, 400);
    }
    if (
      !isUuid(body?.requestId) ||
      body.acceptTerms !== true ||
      Object.keys(body).some((k) => !['requestId', 'acceptTerms'].includes(k))
    )
      return json({ error: 'Подтверди условия покупки.' }, 400);
    const { data, error } = await db.rpc('create_star_order', {
      p_user: userId,
      p_request: body.requestId,
      p_amount: config.amount,
    });
    if (error || !['pending', 'approved'].includes(data?.state))
      return json({ error: 'Счёт недоступен или Premium уже активен.' }, 409);
    const result = await telegramCall(
      'createInvoiceLink',
      invoiceParameters(data.payload, data.amount),
    );
    if (typeof result !== 'string' || !/^https:\/\/t.me\//.test(result))
      return json({ error: 'Не удалось создать счёт.' }, 503);
    return json({ invoiceUrl: result });
  });
}
