export type ExperiencePreferences = { haptics: boolean; effects: boolean };
export const defaultExperiencePreferences: ExperiencePreferences = {
  haptics: false,
  effects: true,
};
export const experienceStorageKey = 'voklumi.experience.v1';
let preferences = defaultExperiencePreferences;
let loaded = false;
const listeners = new Set<() => void>();
export function parseExperiencePreferences(
  raw: string | null,
): ExperiencePreferences {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (
      value?.version === 1 &&
      typeof value.haptics === 'boolean' &&
      typeof value.effects === 'boolean'
    )
      return { haptics: value.haptics, effects: value.effects };
  } catch {}
  return defaultExperiencePreferences;
}
export function syncExperiencePreferences(raw: string | null) {
  const next = parseExperiencePreferences(raw);
  if (
    next.haptics === preferences.haptics &&
    next.effects === preferences.effects
  )
    return;
  preferences = next;
  listeners.forEach((listener) => listener());
}
export function initializeExperiencePreferences() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    syncExperiencePreferences(
      window.localStorage.getItem(experienceStorageKey),
    );
  } catch {}
}
export function getExperiencePreferences() {
  return preferences;
}
export function subscribeExperiencePreferences(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setExperiencePreferences(
  patch: Partial<ExperiencePreferences>,
) {
  initializeExperiencePreferences();
  const next = { ...preferences, ...patch };
  syncExperiencePreferences(JSON.stringify({ version: 1, ...next }));
  try {
    window.localStorage.setItem(
      experienceStorageKey,
      JSON.stringify({ version: 1, ...preferences }),
    );
  } catch {}
}

type HapticCue = 'tap' | 'correct' | 'incorrect' | 'complete';
type HapticBridge = {
  impact: () => void;
  notification: (type: 'success' | 'error') => void;
};
let bridge: HapticBridge | null = null;
let lastTap = -Infinity;
export function setHapticBridge(next: HapticBridge | null) {
  bridge = next;
}
export function playHaptic(cue: HapticCue) {
  if (
    !preferences.haptics ||
    !bridge ||
    typeof document === 'undefined' ||
    document.hidden
  )
    return;
  try {
    if (cue === 'tap') {
      const now = Date.now();
      if (now - lastTap < 80) return;
      lastTap = now;
      bridge.impact();
    } else bridge.notification(cue === 'incorrect' ? 'error' : 'success');
  } catch {
    /* Unsupported clients must never interrupt learning. */
  }
}
