import { lessonRequest, json, isUuid } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { billingConfiguration, invoiceParameters } from '@/lib/billing/config';
import { telegramCall } from '@/lib/billing/telegram';
import { premiumPlans } from '@/lib/billing/plans';
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
      !premiumPlans.some((p) => p.id === body.plan) ||
      Object.keys(body).some(
        (k) => !['requestId', 'acceptTerms', 'plan'].includes(k),
      )
    )
      return json({ error: 'Подтверди условия покупки.' }, 400);
    const plan = premiumPlans.find((p) => p.id === body.plan)!;
    const { data, error } = await db.rpc('create_star_plan_order', {
      p_user: userId,
      p_request: body.requestId,
      p_plan: plan.id,
    });
    if (
      error ||
      !['pending', 'approved'].includes(data?.state) ||
      data.amount !== plan.amount ||
      data.days !== plan.days
    )
      return json({ error: 'Счёт недоступен или Premium уже активен.' }, 409);
    const result = await telegramCall(
      'createInvoiceLink',
      invoiceParameters(data.payload, data.amount, plan.days),
    );
    if (typeof result !== 'string' || !/^https:\/\/t.me\//.test(result))
      return json({ error: 'Не удалось создать счёт.' }, 503);
    return json({ invoiceUrl: result });
  });
}
