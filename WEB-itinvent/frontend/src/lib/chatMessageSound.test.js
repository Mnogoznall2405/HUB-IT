import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHAT_MESSAGE_SOUND_MIN_INTERVAL_MS,
  playChatMessageSound,
  resetChatMessageSoundThrottleForTests,
} from './chatMessageSound';

const buildAudioContextStub = () => ({
  state: 'running',
  currentTime: 0,
  resume: vi.fn().mockResolvedValue(undefined),
  destination: {},
  createOscillator: () => ({
    type: 'sine',
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }),
  createGain: () => ({
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }),
});

describe('playChatMessageSound', () => {
  const OriginalAudioContext = window.AudioContext;

  beforeEach(() => {
    resetChatMessageSoundThrottleForTests();
  });

  afterEach(() => {
    window.AudioContext = OriginalAudioContext;
    vi.restoreAllMocks();
  });

  it('plays a short blip through WebAudio', () => {
    const ctx = buildAudioContextStub();
    window.AudioContext = vi.fn(() => ctx);
    expect(playChatMessageSound()).toBe(true);
    expect(window.AudioContext).toHaveBeenCalled();
  });

  it('throttles bursts to one sound per interval', () => {
    const ctx = buildAudioContextStub();
    window.AudioContext = vi.fn(() => ctx);
    const t0 = 1_000_000;
    expect(playChatMessageSound({ now: t0 })).toBe(true);
    expect(playChatMessageSound({ now: t0 + 100 })).toBe(false);
    expect(playChatMessageSound({ now: t0 + CHAT_MESSAGE_SOUND_MIN_INTERVAL_MS + 1 })).toBe(true);
  });

  it('stays silent without AudioContext support', () => {
    window.AudioContext = undefined;
    expect(playChatMessageSound()).toBe(false);
  });

  it('ignores AudioContext constructor failures (autoplay policy)', () => {
    window.AudioContext = vi.fn(() => { throw new Error('blocked'); });
    expect(playChatMessageSound()).toBe(false);
  });
});
