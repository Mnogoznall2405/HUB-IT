import { normalizeAndroidProcessHealth } from './androidProcessHealth';

describe('Android process health', () => {
  it('keeps only bounded privacy-safe exit reasons and aggregates them', () => {
    const now = 1_787_500_000_000;
    const snapshot = normalizeAndroidProcessHealth({
      supported: true,
      entries: [
        { timestampMs: now - 1_000, reason: 'anr' },
        { timestampMs: now - 2_000, reason: 'crash' },
        { timestampMs: now - 3_000, reason: 'native_crash' },
        { timestampMs: now - 4_000, reason: 'low_memory' },
        { timestampMs: now - 5_000, reason: 'user_requested' },
        { timestampMs: now - 6_000, reason: 'future-android-reason' },
        { timestampMs: now - 1_000, reason: 'anr' },
        { timestampMs: now + 10 * 60 * 1000, reason: 'crash' },
      ],
    }, now);

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      status: 'available',
      counts: {
        anr: 1,
        crash: 1,
        nativeCrash: 1,
        lowMemory: 1,
        otherUnexpected: 1,
        expected: 1,
      },
    });
    expect(snapshot.recent).toHaveLength(6);
    expect(JSON.stringify(snapshot)).not.toContain('description');
    expect(JSON.stringify(snapshot)).not.toContain('trace');
    expect(JSON.stringify(snapshot)).not.toContain('pid');
  });

  it('reports unsupported Android versions without synthetic failures', () => {
    expect(normalizeAndroidProcessHealth({ supported: false, entries: [] })).toMatchObject({
      status: 'unsupported',
      counts: { anr: 0, crash: 0, nativeCrash: 0 },
      recent: [],
    });
  });
});
