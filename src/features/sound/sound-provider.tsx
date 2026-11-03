'use client';
import { useEffect, useSyncExternalStore, useRef, useCallback } from 'react';
import {
  defaultSoundPreferences,
  getSoundPreferences,
  subscribeSoundPreferences,
  initializeSoundPreferences,
  syncSoundPreferences,
  soundStorageKey,
  unlockSounds,
  playSound,
  stopAllSounds,
  disposeSounds,
  type SoundCue,
} from '@/lib/sound/audio';
export function useSoundPreferences() {
  return useSyncExternalStore(
    subscribeSoundPreferences,
    getSoundPreferences,
    () => defaultSoundPreferences,
  );
}
/** Async feedback from a screen that has already closed must stay silent. */
export function useSoundEffects() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback((cue: SoundCue) => {
    if (mounted.current) playSound(cue);
  }, []);
}
export function SoundProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initializeSoundPreferences();
    const click = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const target = event.target.closest(
        'button,a[href],[role="button"],[role="switch"],input[type="checkbox"],input[type="radio"]',
      );
      if (
        !target ||
        target.closest('[data-sound="off"],[inert]') ||
        target.matches(':disabled,[aria-disabled="true"]')
      )
        return;
      unlockSounds();
      playSound('tap');
    };
    const storage = (event: StorageEvent) => {
      if (event.key === soundStorageKey || event.key === null)
        syncSoundPreferences(event.newValue);
    };
    const visibility = () => {
      if (document.hidden) stopAllSounds();
    };
    document.addEventListener('click', click, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('storage', storage);
    window.addEventListener('pagehide', stopAllSounds);
    return () => {
      document.removeEventListener('click', click, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('storage', storage);
      window.removeEventListener('pagehide', stopAllSounds);
      disposeSounds();
    };
  }, []);
  return children;
}
