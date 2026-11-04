export const themes = {
  base: {
    name: 'Voklumi Dark',
    premium: false,
    colors: ['#10101e', '#1b1b2f', '#aa8bff'],
  },
  slate: {
    name: 'Slate',
    premium: false,
    colors: ['#111820', '#1b2632', '#a5c9f5'],
  },
  ocean: {
    name: 'Ocean',
    premium: false,
    colors: ['#091c23', '#122e38', '#80d9e7'],
  },
  midnight: {
    name: 'Midnight Purple',
    premium: true,
    colors: ['#160d26', '#25183c', '#c3a0ff'],
  },
  cyber: {
    name: 'Cyber Blue',
    premium: true,
    colors: ['#091526', '#122c47', '#85ccff'],
  },
  neon: {
    name: 'Neon Green',
    premium: true,
    colors: ['#0e1b12', '#1a2e21', '#a0ec9e'],
  },
  sunset: {
    name: 'Sunset',
    premium: true,
    colors: ['#24131b', '#38232b', '#ffb18a'],
  },
  sakura: {
    name: 'Sakura',
    premium: true,
    colors: ['#221421', '#352334', '#f7aed4'],
  },
} as const;
export type Appearance = {
  theme: keyof typeof themes;
  frame: 'plain' | 'orbit' | 'pulse';
  badge: 'none' | 'star' | 'leaf';
  effect: 'none' | 'spark' | 'ripple';
  decoration: 'none' | 'dots' | 'grid';
};
export type AppearanceData = {
  premium: boolean;
  version: number;
  saved: Appearance;
  effective: Appearance;
  expiresAt: string | null;
  serverTime: string;
};
export const defaultAppearance: Appearance = {
  theme: 'base',
  frame: 'plain',
  badge: 'none',
  effect: 'none',
  decoration: 'none',
};
export function themeVariables(theme: Appearance['theme']) {
  const c = themes[theme]?.colors ?? themes.base.colors;
  return {
    '--background': c[0],
    '--card': c[1],
    '--primary': c[2],
    '--primary-foreground': theme === 'base' ? '#170c36' : '#10121b',
    '--foreground': '#f4f3ff',
    '--muted': theme === 'base' ? '#25243b' : c[1],
    '--muted-foreground': theme === 'base' ? '#aaa9c5' : '#bcbad0',
    '--border': theme === 'base' ? '#303047' : '#555366',
  };
}
export function appearanceValid(v: unknown): v is Appearance {
  if (!v || typeof v !== 'object') return false;
  const d = v as Appearance;
  return (
    Object.keys(d).sort().join() === 'badge,decoration,effect,frame,theme' &&
    Object.hasOwn(themes, d.theme) &&
    ['plain', 'orbit', 'pulse'].includes(d.frame) &&
    ['none', 'star', 'leaf'].includes(d.badge) &&
    ['none', 'spark', 'ripple'].includes(d.effect) &&
    ['none', 'dots', 'grid'].includes(d.decoration)
  );
}
