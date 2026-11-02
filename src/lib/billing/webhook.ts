import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { billingConfiguration } from './config';
import { processStarsUpdate } from './events';
import { telegramCall } from './telegram';
export async function handleStarsWebhook(update: unknown) {
  return processStarsUpdate(update, {
    enabled: billingConfiguration(process.env).enabled,
    check: async (q) => {
      const { data, error } = await createServiceClient()
        .rpc('check_star_checkout', {
          p_payload: q.payload,
          p_tg: q.telegramId,
          p_currency: q.currency,
          p_amount: q.amount,
          p_query: q.id,
        })
        .abortSignal(AbortSignal.timeout(2500));
      return !error && data === true;
    },
    answer: async (id, ok) => {
      await telegramCall(
        'answerPreCheckoutQuery',
        {
          pre_checkout_query_id: id,
          ok,
          ...(!ok
            ? {
                error_message:
                  'Оплата недоступна или счёт устарел. Открой Premium заново.',
              }
            : {}),
        },
        2500,
      );
    },
    apply: async (e) => {
      const { error } = await createServiceClient().rpc('apply_star_event', {
        p_payload: e.payload,
        p_tg: e.telegramId,
        p_currency: e.currency,
        p_amount: e.amount,
        p_charge: e.chargeId,
        p_refund: e.kind === 'refund',
      });
      if (error) throw new Error('Payment persistence failed');
    },
  });
}
