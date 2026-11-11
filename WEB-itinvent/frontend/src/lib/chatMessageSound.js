/**
 * N1: short in-app sound for incoming chat messages.
 *
 * WebAudio two-tone blip instead of an audio asset — the repo ships no sound
 * files, and a synthesized blip cannot 404 or be blocked by asset caching.
 * Autoplay-policy failures are intentionally swallowed (user decision).
 */

export const CHAT_MESSAGE_SOUND_MIN_INTERVAL_MS = 1500;

let audioContext = null;
let lastPlayedAt = 0;

export function resetChatMessageSoundThrottleForTests() {
  lastPlayedAt = 0;
  audioContext = null;
}

export function playChatMessageSound({ now = Date.now() } = {}) {
  if (now - lastPlayedAt < CHAT_MESSAGE_SOUND_MIN_INTERVAL_MS) return false;
  try {
    const scope = typeof globalThis !== 'undefined' ? globalThis : null;
    const AudioContextCtor = scope
      ? (scope.AudioContext || scope.webkitAudioContext)
      : null;
    if (!AudioContextCtor) return false;
    lastPlayedAt = now;
    audioContext = audioContext || new AudioContextCtor();
    const ctx = audioContext;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* autoplay policy — ignore */ });
    }
    const startAt = ctx.currentTime + 0.01;
    [880, 1174.66].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = startAt + index * 0.09;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(t0);
      oscillator.stop(t0 + 0.16);
    });
    return true;
  } catch {
    audioContext = null;
    return false;
  }
}
