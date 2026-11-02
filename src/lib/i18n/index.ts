import { ru } from './ru';
export const defaultLocale = 'ru' as const;
export const dictionaries = { ru };
export type Locale = keyof typeof dictionaries;
export function getDictionary(locale: Locale = defaultLocale) {
  return dictionaries[locale];
}
