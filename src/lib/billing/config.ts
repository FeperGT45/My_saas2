import { premiumPlans, premiumSupportUrl } from './plans';
export function billingConfiguration(env: Record<string, string | undefined>) {
  const urls = [env.PREMIUM_TERMS_URL, premiumSupportUrl].map((value) => {
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
      urls.every(Boolean),
    amount: premiumPlans[1].amount,
    plans: premiumPlans,
    termsUrl: urls[0],
    supportUrl: urls[1],
  };
}
export function invoiceParameters(
  payload: string,
  amount: number,
  days: 7 | 30 = 30,
) {
  return {
    title: `Voklumi Premium · ${days} дней`,
    description: `Доступ Premium на ${days} дней без автоматического продления.`,
    payload,
    currency: 'XTR',
    provider_token: '',
    prices: [{ label: `Premium · ${days} дней`, amount }],
  };
}
