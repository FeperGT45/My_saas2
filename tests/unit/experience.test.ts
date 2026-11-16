import { beforeEach, afterEach, it, expect, vi } from 'vitest';
let store: typeof import('@/lib/experience/preferences');
let storage: Map<string, string>;
beforeEach(async () => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  vi.stubGlobal('document', { hidden: false });
  store = await import('@/lib/experience/preferences');
});
afterEach(() => vi.unstubAllGlobals());
it('validates stored version and complete boolean preferences', () => {
  for (const raw of [
    '{',
    '{}',
    '{"version":2,"haptics":true,"effects":false}',
    '{"version":1,"haptics":"yes","effects":false}',
  ])
    expect(store.parseExperiencePreferences(raw)).toEqual({
      haptics: false,
      effects: true,
    });
});
it('restores preferences without changing them on repeated initialization', () => {
  storage.set(
    store.experienceStorageKey,
    '{"version":1,"haptics":true,"effects":false}',
  );
  store.initializeExperiencePreferences();
  expect(store.getExperiencePreferences()).toEqual({
    haptics: true,
    effects: false,
  });
  store.setExperiencePreferences({ haptics: false });
  store.initializeExperiencePreferences();
  expect(JSON.parse(storage.get(store.experienceStorageKey)!)).toEqual({
    version: 1,
    haptics: false,
    effects: false,
  });
});
it('notifies subscribers once for changes and resets on storage removal', () => {
  const listener = vi.fn(),
    unsubscribe = store.subscribeExperiencePreferences(listener);
  store.setExperiencePreferences({ effects: false });
  store.setExperiencePreferences({ effects: false });
  expect(listener).toHaveBeenCalledTimes(1);
  store.syncExperiencePreferences(null);
  expect(store.getExperiencePreferences().effects).toBe(true);
  unsubscribe();
  store.setExperiencePreferences({ effects: false });
  expect(listener).toHaveBeenCalledTimes(2);
});
it('survives blocked browser storage and unavailable haptics', () => {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
    },
  });
  expect(() =>
    store.setExperiencePreferences({ effects: false }),
  ).not.toThrow();
  expect(store.getExperiencePreferences().effects).toBe(false);
  expect(() => store.playHaptic('tap')).not.toThrow();
});
it('uses Telegram feedback only when enabled and visible; throttles taps', () => {
  const impact = vi.fn(),
    notification = vi.fn();
  store.setHapticBridge({ impact, notification });
  store.playHaptic('tap');
  expect(impact).not.toHaveBeenCalled();
  store.setExperiencePreferences({ haptics: true });
  store.playHaptic('tap');
  store.playHaptic('tap');
  expect(impact).toHaveBeenCalledTimes(1);
  store.playHaptic('correct');
  store.playHaptic('incorrect');
  store.playHaptic('complete');
  expect(notification.mock.calls).toEqual([
    ['success'],
    ['error'],
    ['success'],
  ]);
  vi.stubGlobal('document', { hidden: true });
  store.playHaptic('correct');
  expect(notification).toHaveBeenCalledTimes(3);
  store.setHapticBridge(null);
  expect(() => store.playHaptic('tap')).not.toThrow();
});
it('ignores failures from unsupported clients', () => {
  store.setExperiencePreferences({ haptics: true });
  store.setHapticBridge({
    impact: () => {
      throw Error();
    },
    notification: () => {
      throw Error();
    },
  });
  expect(() => store.playHaptic('incorrect')).not.toThrow();
});
