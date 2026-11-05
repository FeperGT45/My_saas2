/** Owner-approved one-time access passes. Price and duration never come from clients. */
export const premiumPlans = [
  { id: 'week', title: 'Неделя', days: 7, amount: 49 },
  { id: 'month', title: 'Месяц', days: 30, amount: 149 },
] as const;
export type PremiumPlanId = (typeof premiumPlans)[number]['id'];
export const premiumSupportUrl = 'https://t.me/feper145';
