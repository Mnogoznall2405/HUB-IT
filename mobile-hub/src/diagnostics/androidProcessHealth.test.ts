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
      schemaVersion: 2,
      status: 'available',
      counts: {
        anr: 1,
        crash: 1,
        nativeCrash: 1,
        lowMemory: 1,
        otherUnexpected: 1,
        expected: 1,
      },
      sinceCurrentBuildFirstSeen: null,
    });
    expect(snapshot.recent).toHaveLength(6);
    expect(JSON.stringify(snapshot)).not.toContain('description');
    expect(JSON.stringify(snapshot)).not.toContain('trace');
    expect(JSON.stringify(snapshot)).not.toContain('pid');
  });

  it('counts exits since the current build boundary separately from all history', () => {
    const now = 1_787_500_000_000;
    const boundary = new Date(now - 2_500).toISOString();
    const snapshot = normalizeAndroidProcessHealth({
      supported: true,
      entries: [
        { timestampMs: now - 1_000, reason: 'crash' },
        { timestampMs: now - 4_000, reason: 'crash' },
        { timestampMs: now - 4_500, reason: 'user_requested' },
      ],
    }, now, boundary);

    expect(snapshot.counts).toMatchObject({ crash: 2, expected: 1 });
    expect(snapshot.sinceCurrentBuildFirstSeen).toEqual({
      at: boundary,
      counts: {
        anr: 0,
        crash: 1,
        nativeCrash: 0,
        lowMemory: 0,
        excessiveResource: 0,
        otherUnexpected: 0,
        expected: 0,
      },
    });
  });

  it('returns no observation window for missing, invalid or future boundaries', () => {
    const now = 1_787_500_000_000;
    const raw = {
      supported: true,
      entries: [{ timestampMs: now - 1_000, reason: 'crash' }],
    };

    expect(normalizeAndroidProcessHealth(raw, now).sinceCurrentBuildFirstSeen).toBeNull();
    expect(normalizeAndroidProcessHealth(raw, now, null).sinceCurrentBuildFirstSeen).toBeNull();
    expect(normalizeAndroidProcessHealth(raw, now, 'not-a-date').sinceCurrentBuildFirstSeen).toBeNull();
    expect(normalizeAndroidProcessHealth(raw, now, new Date(now + 60_000).toISOString())
      .sinceCurrentBuildFirstSeen).toBeNull();
    expect(normalizeAndroidProcessHealth({ supported: false, entries: [] }, now,
      new Date(now - 1_000).toISOString()).sinceCurrentBuildFirstSeen).toBeNull();
  });

  it('reports unsupported Android versions without synthetic failures', () => {
    expect(normalizeAndroidProcessHealth({ supported: false, entries: [] })).toMatchObject({
      schemaVersion: 2,
      status: 'unsupported',
      counts: { anr: 0, crash: 0, nativeCrash: 0 },
      sinceCurrentBuildFirstSeen: null,
      recent: [],
    });
  });
});
