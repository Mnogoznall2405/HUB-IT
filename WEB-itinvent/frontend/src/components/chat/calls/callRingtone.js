// Short WebAudio ringtone without binary assets. Browsers may keep the
// AudioContext suspended until a user gesture: that must never throw, the
// signal is simply silent (the visual window and system notification remain).

const PATTERNS = {
  // Two quick beeps every 2.4 s.
  incoming: { period: 2400, tones: [[880, 0, 0.18], [660, 0.24, 0.18]], volume: 0.12 },
  // Quiet ringback while the callee has not answered yet.
  outgoing: { period: 3200, tones: [[425, 0, 0.9]], volume: 0.06 },
};

const getAudioContextCtor = () => {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
};

export function createRingtone(kind = 'incoming') {
  const pattern = PATTERNS[kind] || PATTERNS.incoming;
  let context = null;
  let timerId = null;
  let running = false;

  const ensureContext = () => {
    if (context) return context;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      context = null;
    }
    return context;
  };

  const playOnce = () => {
    const ctx = ensureContext();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') void ctx.resume?.().catch?.(() => {});
      // Still blocked by the autoplay policy — skip this cycle quietly.
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      pattern.tones.forEach(([frequency, offset, duration]) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(pattern.volume, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + duration + 0.05);
      });
    } catch {
      // Audio is best-effort.
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      playOnce();
      timerId = window.setInterval(playOnce, pattern.period);
    },
    stop() {
      running = false;
      if (timerId != null) {
        window.clearInterval(timerId);
        timerId = null;
      }
      if (context) {
        const closing = context;
        context = null;
        try {
          void closing.close?.().catch?.(() => {});
        } catch {
          // Ignore close failures.
        }
      }
    },
  };
}
