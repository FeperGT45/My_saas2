/** Shared names and DTOs only. This module never authorizes a server operation. */
export const premiumFeatures = [
  'premium_courses',
  'extra_exercises',
  'advanced_statistics',
  'lesson_review_plan',
] as const;
export type PremiumFeature = (typeof premiumFeatures)[number];
export type SubscriptionAccess = {
  version: 'permissions-v1';
  plan: 'free' | 'premium';
  premium: boolean;
  status:
    | 'free'
    | 'active'
    | 'scheduled'
    | 'expired'
    | 'cancelled'
    | 'refunded'
    | 'refund_pending';
  startsAt: string | null;
  expiresAt: string | null;
  serverTime: string;
  autoRenew: false;
  features: Record<PremiumFeature, boolean>;
};
export type PremiumStatus = SubscriptionAccess & {
  enabled: boolean;
  amount: number | null;
  termsUrl: string | null;
  supportUrl: string | null;
};
/** Fail closed if an old/incomplete database response is received. */
export function isSubscriptionAccess(
  value: unknown,
): value is SubscriptionAccess {
  if (!value || typeof value !== 'object') return false;
  const v = value as SubscriptionAccess;
  const date = (s: unknown) =>
    typeof s === 'string' && Number.isFinite(Date.parse(s));
  return (
    v.version === 'permissions-v1' &&
    ['free', 'premium'].includes(v.plan) &&
    typeof v.premium === 'boolean' &&
    v.premium === (v.plan === 'premium') &&
    [
      'free',
      'active',
      'scheduled',
      'expired',
      'cancelled',
      'refunded',
      'refund_pending',
    ].includes(v.status) &&
    v.premium === ['active', 'refund_pending'].includes(v.status) &&
    (v.startsAt === null || date(v.startsAt)) &&
    (v.expiresAt === null || date(v.expiresAt)) &&
    date(v.serverTime) &&
    v.autoRenew === false &&
    !!v.features &&
    premiumFeatures.every((k) => typeof v.features[k] === 'boolean') &&
    (!v.premium ||
      (date(v.startsAt) &&
        date(v.expiresAt) &&
        Date.parse(v.startsAt!) <= Date.parse(v.serverTime) &&
        Date.parse(v.expiresAt!) > Date.parse(v.serverTime)))
  );
}
