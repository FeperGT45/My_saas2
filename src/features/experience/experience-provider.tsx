'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import {
  defaultExperiencePreferences,
  getExperiencePreferences,
  subscribeExperiencePreferences,
  initializeExperiencePreferences,
  syncExperiencePreferences,
  experienceStorageKey,
  playHaptic,
} from '@/lib/experience/preferences';
export function useExperiencePreferences() {
  return useSyncExternalStore(
    subscribeExperiencePreferences,
    getExperiencePreferences,
    () => defaultExperiencePreferences,
  );
}
export function useReducedEffects() {
  const reduced = useReducedMotion();
  const { effects } = useExperiencePreferences();
  return !effects || Boolean(reduced);
}
export function ExperienceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { effects } = useExperiencePreferences();
  useEffect(() => {
    initializeExperiencePreferences();
    const storage = (event: StorageEvent) => {
      if (event.key === experienceStorageKey || event.key === null)
        syncExperiencePreferences(event.key === null ? null : event.newValue);
    };
    const click = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const target = event.target.closest(
        'button,a[href],[role="button"],[role="switch"]',
      );
      if (
        target &&
        !target.closest('[inert],[data-haptic="off"]') &&
        !target.matches(':disabled,[aria-disabled="true"]')
      )
        playHaptic('tap');
    };
    window.addEventListener('storage', storage);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('storage', storage);
      document.removeEventListener('click', click, true);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.effects = effects ? 'on' : 'off';
  }, [effects]);
  return (
    <MotionConfig reducedMotion={effects ? 'user' : 'always'}>
      {children}
    </MotionConfig>
  );
}
