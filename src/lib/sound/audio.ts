export type SoundCue = 'tap' | 'correct' | 'incorrect' | 'complete';
export type SoundPreferences = { enabled: boolean; speech: boolean };
export const defaultSoundPreferences: SoundPreferences = {
  enabled: true,
  speech: true,
};
export const soundStorageKey = 'voklumi.sound.v1';
let preferences = defaultSoundPreferences;
let loaded = false;
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
const oscillators = new Set<OscillatorNode>();
let generation = 0;
let lastTap = -Infinity;
let cueUntil = 0;
let speechActive = false;
let stopSpeech: (() => void) | null = null;

export function parseSoundPreferences(raw: string | null): SoundPreferences {
  try {
    const data = JSON.parse(raw ?? 'null');
    if (
      data?.version === 1 &&
      typeof data.enabled === 'boolean' &&
      typeof data.speech === 'boolean'
    )
      return { enabled: data.enabled, speech: data.speech };
  } catch {}
  return defaultSoundPreferences;
}
function applyPreferences(next: SoundPreferences) {
  if (
    next.enabled === preferences.enabled &&
    next.speech === preferences.speech
  )
    return;
  preferences = next;
  if (!next.enabled) stopEffects();
  if (!next.enabled || !next.speech) stopSpeech?.();
  listeners.forEach((listener) => listener());
}
export function initializeSoundPreferences() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    applyPreferences(
      parseSoundPreferences(window.localStorage.getItem(soundStorageKey)),
    );
  } catch {}
}
export function syncSoundPreferences(raw: string | null) {
  loaded = true;
  applyPreferences(parseSoundPreferences(raw));
}
export function getSoundPreferences() {
  return preferences;
}
export function subscribeSoundPreferences(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setSoundPreferences(patch: Partial<SoundPreferences>) {
  initializeSoundPreferences();
  applyPreferences({
    enabled: patch.enabled ?? preferences.enabled,
    speech: patch.speech ?? preferences.speech,
  });
  try {
    window.localStorage.setItem(
      soundStorageKey,
      JSON.stringify({ version: 1, ...preferences }),
    );
  } catch {}
}
export function stopEffects() {
  generation++;
  cueUntil = 0;
  for (const oscillator of oscillators) {
    try {
      oscillator.stop();
      oscillator.disconnect();
    } catch {}
  }
  oscillators.clear();
}
export function stopAllSounds() {
  stopEffects();
  stopSpeech?.();
}
export function disposeSounds() {
  stopAllSounds();
  const previous = context;
  context = null;
  if (previous) void previous.close().catch(() => {});
}
/** Called only by a trusted click: creates/unlocks audio without autoplay on page load. */
export function unlockSounds() {
  initializeSoundPreferences();
  if (!preferences.enabled || typeof window === 'undefined') return;
  try {
    const Constructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!context || context.state === 'closed')
      context = Constructor ? new Constructor() : null;
    if (context?.state === 'suspended') void context.resume().catch(() => {});
  } catch {
    context = null;
  }
}
const melodies: Record<SoundCue, readonly [number, number, number][]> = {
  tap: [[660, 0, 0.035]],
  correct: [
    [523.25, 0, 0.09],
    [659.25, 0.075, 0.12],
    [783.99, 0.15, 0.14],
  ],
  incorrect: [
    [293.66, 0, 0.13],
    [246.94, 0.11, 0.16],
  ],
  complete: [
    [523.25, 0, 0.12],
    [659.25, 0.11, 0.12],
    [783.99, 0.22, 0.12],
    [1046.5, 0.34, 0.25],
  ],
};
/** Feedback never creates a context: it uses the context unlocked by the user's interaction. */
export function playSound(cue: SoundCue) {
  if (
    !preferences.enabled ||
    speechActive ||
    !context ||
    (typeof document !== 'undefined' && document.hidden)
  )
    return;
  const clock = performance.now();
  if (cue === 'tap' && (clock - lastTap < 60 || clock < cueUntil)) return;
  if (cue === 'tap') lastTap = clock;
  else stopEffects();
  const audio = context;
  const ticket = generation;
  if (cue !== 'tap') cueUntil = clock + 650;
  void (async () => {
    if (audio.state !== 'running') await audio.resume();
    if (
      ticket !== generation ||
      !preferences.enabled ||
      speechActive ||
      audio !== context ||
      audio.state !== 'running'
    )
      return;
    const start = audio.currentTime;
    for (const [frequency, offset, duration] of melodies[cue]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start + offset);
      gain.gain.setValueAtTime(0, start + offset);
      gain.gain.linearRampToValueAtTime(
        cue === 'tap' ? 0.035 : 0.065,
        start + offset + 0.008,
      );
      gain.gain.exponentialRampToValueAtTime(0.001, start + offset + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillators.add(oscillator);
      oscillator.onended = () => {
        oscillators.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start + offset);
      oscillator.stop(start + offset + duration + 0.01);
    }
  })().catch(() => {});
}

/** Explicit speech action. Returned cancellation belongs only to this utterance. */
export function speakExercise(
  text: string,
  lang: string,
  rate: number,
  done: () => void,
  failed: () => void,
): (() => void) | null {
  initializeSoundPreferences();
  if (
    !preferences.enabled ||
    !preferences.speech ||
    typeof window === 'undefined'
  )
    return null;
  if (
    typeof window.speechSynthesis?.speak !== 'function' ||
    typeof window.SpeechSynthesisUtterance !== 'function'
  )
    return null;
  stopSpeech?.();
  stopEffects();
  let active = true;
  const finish = (error = false) => {
    if (!active) return;
    active = false;
    speechActive = false;
    stopSpeech = null;
    if (error) failed();
    else done();
  };
  const cancel = () => {
    if (!active) return;
    try {
      window.speechSynthesis.cancel();
    } catch {}
    finish();
  };
  try {
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.volume = 0.85;
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    const matches = voices.filter(
      (v) =>
        v.lang.toLowerCase().replace('_', '-') ===
        lang.toLowerCase().replace('_', '-'),
    );
    const voice = matches.find((v) => v.localService) ?? matches[0];
    if (voice) utterance.voice = voice;
    utterance.onend = () => finish();
    utterance.onerror = () => finish(true);
    speechActive = true;
    stopSpeech = cancel;
    window.speechSynthesis.speak(utterance);
    return cancel;
  } catch {
    finish(true);
    return null;
  }
}
