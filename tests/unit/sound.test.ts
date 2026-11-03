import { beforeEach, afterEach, it, expect, vi } from 'vitest';
let audio: typeof import('@/lib/sound/audio');
let instances: FakeContext[];
class FakeContext {
  state = 'running';
  currentTime = 10;
  destination = {};
  nodes: {
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  constructor() {
    instances.push(this);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createOscillator() {
    const node = {
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      onended: null,
      type: '',
    };
    this.nodes.push(node);
    return node;
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}
beforeEach(async () => {
  vi.resetModules();
  instances = [];
  vi.stubGlobal('window', {
    AudioContext: FakeContext,
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    speechSynthesis: { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] },
    SpeechSynthesisUtterance: class {
      constructor(public text: string) {}
    },
  });
  vi.stubGlobal('document', { hidden: false });
  audio = await import('@/lib/sound/audio');
});
afterEach(() => {
  audio.disposeSounds();
  vi.unstubAllGlobals();
});
it('never autoplays on load; a gesture unlocks one context and generates quiet scheduled notes', () => {
  audio.initializeSoundPreferences();
  audio.playSound('correct');
  expect(instances).toHaveLength(0);
  audio.unlockSounds();
  audio.playSound('complete');
  expect(instances).toHaveLength(1);
  expect(instances[0].nodes).toHaveLength(4);
  expect(instances[0].nodes[0].frequency.setValueAtTime).toHaveBeenCalledWith(
    523.25,
    10,
  );
  audio.playSound('tap');
  expect(instances[0].nodes).toHaveLength(4); // no clicks over a celebration
});
it('muting stops effects and prevents new contexts or notes; preferences persist', () => {
  audio.unlockSounds();
  audio.playSound('correct');
  audio.setSoundPreferences({ enabled: false });
  expect(instances[0].nodes.every((n) => n.stop.mock.calls.length >= 2)).toBe(
    true,
  );
  audio.playSound('incorrect');
  expect(instances[0].nodes).toHaveLength(3);
  expect(window.localStorage.setItem).toHaveBeenCalledWith(
    audio.soundStorageKey,
    JSON.stringify({ version: 1, enabled: false, speech: true }),
  );
  audio.disposeSounds();
  audio.unlockSounds();
  expect(instances).toHaveLength(1);
});
it('storage sync and malformed/blocked storage cannot crash the app or enable arbitrary settings', () => {
  expect(audio.parseSoundPreferences('{bad')).toEqual(
    audio.defaultSoundPreferences,
  );
  expect(
    audio.parseSoundPreferences('{"version":1,"enabled":"true","speech":true}'),
  ).toEqual(audio.defaultSoundPreferences);
  audio.syncSoundPreferences('{"version":1,"enabled":false,"speech":false}');
  expect(audio.getSoundPreferences()).toEqual({
    enabled: false,
    speech: false,
  });
  vi.mocked(window.localStorage.setItem).mockImplementation(() => {
    throw Error('blocked');
  });
  expect(() => audio.setSoundPreferences({ enabled: true })).not.toThrow();
  expect(audio.getSoundPreferences().enabled).toBe(true);
});
it('speech suppresses effects; mute cancels it immediately and old cleanup cannot cancel a newer phrase', () => {
  audio.unlockSounds();
  const done = vi.fn(),
    failed = vi.fn();
  const old = audio.speakExercise('Hello', 'en-US', 0.85, done, failed)!;
  audio.playSound('tap');
  expect(instances[0].nodes).toHaveLength(0);
  const current = audio.speakExercise(
    'Good morning',
    'en-US',
    0.6,
    done,
    failed,
  )!;
  expect(done).toHaveBeenCalledTimes(1);
  old();
  expect(window.speechSynthesis.cancel).toHaveBeenCalledTimes(1);
  audio.setSoundPreferences({ speech: false });
  expect(done).toHaveBeenCalledTimes(2);
  current();
  expect(window.speechSynthesis.cancel).toHaveBeenCalledTimes(2);
  expect(failed).not.toHaveBeenCalled();
});
it('unsupported audio and failing speech degrade without uncaught errors', () => {
  window.AudioContext = undefined as unknown as typeof AudioContext;
  expect(() => {
    audio.unlockSounds();
    audio.playSound('tap');
  }).not.toThrow();
  const failed = vi.fn();
  vi.mocked(window.speechSynthesis.speak).mockImplementation(() => {
    throw Error('no device');
  });
  expect(
    audio.speakExercise('Hello', 'en-US', 0.85, vi.fn(), failed),
  ).toBeNull();
  expect(failed).toHaveBeenCalledOnce();
});
it('a pending resume cannot play late effects after muting', async () => {
  audio.unlockSounds();
  const ctx = instances[0];
  ctx.state = 'suspended';
  let release!: () => void;
  ctx.resume.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = () => {
          ctx.state = 'running';
          resolve();
        };
      }),
  );
  audio.playSound('correct');
  audio.setSoundPreferences({ enabled: false });
  release();
  await Promise.resolve();
  expect(ctx.nodes).toHaveLength(0);
});
