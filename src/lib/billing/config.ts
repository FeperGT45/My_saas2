export function billingConfiguration(env: Record<string, string | undefined>) {
  const amount = Number(env.TELEGRAM_STARS_PREMIUM_PRICE);
  const urls = [env.PREMIUM_TERMS_URL, env.PAYMENT_SUPPORT_URL].map((value) => {
    try {
      const url = new URL(value ?? '');
      return url.protocol === 'https:' && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  });
  return {
    enabled:
      env.TELEGRAM_STARS_PAYMENTS_ENABLED === 'true' &&
      env.TELEGRAM_STARS_OWNER_REVIEWED === 'true' &&
      Boolean(env.TELEGRAM_BOT_TOKEN) &&
      Boolean(
        env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_WEBHOOK_SECRET.length >= 32,
      ) &&
      urls.every(Boolean) &&
      Number.isInteger(amount) &&
      amount > 0 &&
      amount <= 10000,
    amount:
      Number.isInteger(amount) && amount > 0 && amount <= 10000 ? amount : null,
    termsUrl: urls[0],
    supportUrl: urls[1],
  };
}
export function invoiceParameters(payload: string, amount: number) {
  return {
    title: 'Voklumi Premium · 30 дней',
    description: 'Доступ Premium на 30 дней без автоматического продления.',
    payload,
    currency: 'XTR',
    provider_token: '',
    prices: [{ label: 'Premium · 30 дней', amount }],
  };
}
