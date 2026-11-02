export type Checkout = {
  kind: 'checkout';
  id: string;
  telegramId: number;
  payload: string;
  currency: string;
  amount: number;
};
export type Receipt = {
  kind: 'paid' | 'refund';
  telegramId: number;
  payload: string;
  currency: string;
  amount: number;
  chargeId: string;
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0;
const string = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 256;
export function parseStarsUpdate(update: unknown): Checkout | Receipt | null {
  const u = record(update);
  if (u.pre_checkout_query) {
    const q = record(u.pre_checkout_query),
      from = record(q.from);
    if (
      !positive(from.id) ||
      !positive(q.total_amount) ||
      !string(q.id) ||
      !string(q.invoice_payload) ||
      !string(q.currency)
    )
      throw new Error('Invalid checkout');
    return {
      kind: 'checkout',
      id: q.id,
      telegramId: from.id,
      payload: q.invoice_payload,
      currency: q.currency,
      amount: q.total_amount,
    };
  }
  const m = record(u.message),
    chat = record(m.chat),
    paid = record(m.successful_payment),
    refund = record(m.refunded_payment);
  if (!m.successful_payment && !m.refunded_payment) return null;
  const p = m.refunded_payment ? refund : paid;
  if (
    chat.type !== 'private' ||
    !positive(chat.id) ||
    !positive(p.total_amount) ||
    !string(p.currency) ||
    !string(p.invoice_payload) ||
    !string(p.telegram_payment_charge_id) ||
    p.is_recurring === true
  )
    throw new Error('Invalid receipt');
  if (m.successful_payment && record(m.from).id !== chat.id)
    throw new Error('Payer mismatch');
  return {
    kind: m.refunded_payment ? 'refund' : 'paid',
    telegramId: chat.id,
    payload: p.invoice_payload,
    currency: p.currency,
    amount: p.total_amount,
    chargeId: p.telegram_payment_charge_id,
  };
}
export async function processStarsUpdate(
  update: unknown,
  deps: {
    enabled: boolean;
    check: (q: Checkout) => Promise<boolean>;
    answer: (id: string, ok: boolean) => Promise<void>;
    apply: (event: Receipt) => Promise<void>;
  },
): Promise<boolean> {
  const event = parseStarsUpdate(update);
  if (!event) return false;
  if (event.kind === 'checkout') {
    let ok = false;
    if (deps.enabled) {
      try {
        ok = await deps.check(event);
      } catch {
        ok = false;
      }
    }
    await deps.answer(event.id, ok);
  } else await deps.apply(event);
  return true;
}
