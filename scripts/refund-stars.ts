// Operator-only. Never expose this workflow as a public user-id/charge-id endpoint.
import { createServiceClient } from '../src/lib/supabase/service';
import { telegramCall } from '../src/lib/billing/telegram';
async function main() {
  if (
    process.env.TELEGRAM_STARS_OWNER_REVIEWED !== 'true' ||
    process.env.TELEGRAM_STARS_REFUNDS_ENABLED !== 'true' ||
    !process.argv.includes('--confirm-owner-refund')
  )
    throw new Error(
      'Refunds are disabled. Complete owner review and explicitly confirm this operation.',
    );
  const id = process.env.STARS_REFUND_ORDER_ID;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id))
    throw new Error('Set STARS_REFUND_ORDER_ID via operator environment.');
  const db = createServiceClient();
  const { data, error } = await db.rpc('prepare_star_refund', { p_order: id });
  if (error) throw new Error('Cannot prepare refund.');
  if (data.state === 'refunded') {
    console.log('Refund already recorded; no Telegram call made.');
    return;
  }
  const refunded = await telegramCall('refundStarPayment', {
    user_id: data.telegramId,
    telegram_payment_charge_id: data.chargeId,
  });
  if (refunded !== true) throw new Error('Refund not confirmed.');
  const applied = await db.rpc('apply_star_event', {
    p_payload: data.payload,
    p_tg: data.telegramId,
    p_currency: 'XTR',
    p_amount: data.amount,
    p_charge: data.chargeId,
    p_refund: true,
  });
  if (applied.error)
    throw new Error(
      'Telegram confirmed refund but database reconciliation is required.',
    );
  console.log('Confirmed refund recorded.');
}
void main().catch(() => {
  console.error(
    'Refund workflow stopped. No credentials or charge details logged. Check operator configuration and reconcile pending refunds before retrying.',
  );
  process.exitCode = 1;
});
