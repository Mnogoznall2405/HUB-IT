import {
  buildDiagnosticReport,
  clearDiagnosticEvents,
  getDiagnosticEventCount,
  getReleaseHealthSnapshot,
  recordDiagnosticEvent,
  recordReleaseHealthMetric,
  startReleaseHealthSession,
} from './diagnostics';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.1.4',
  nativeBuildVersion: '6',
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  Paths: { cache: 'file:///cache' },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

describe('privacy-safe diagnostics', () => {
  beforeEach(async () => {
    await clearDiagnosticEvents();
  });

  it('stores only fixed diagnostic event codes', async () => {
    await recordDiagnosticEvent('native_file_error');
    await recordDiagnosticEvent('ui_render_error');
    await recordDiagnosticEvent('notification_action_error');
    expect(await getDiagnosticEventCount()).toBe(3);
  });

  it('builds a report without user content or credentials', () => {
    const report = buildDiagnosticReport([
      { code: 'native_file_error', at: '2026-08-22T10:00:00.000Z' },
      { code: 'raw-secret' as never, at: '2026-08-22T10:00:01.000Z' },
    ], '2026-08-22T11:00:00.000Z');

    expect(report).toMatchObject({
      schemaVersion: 3,
      generatedAt: '2026-08-22T11:00:00.000Z',
      privacy: 'no-user-content-no-credentials',
      app: { version: '1.1.4', build: '6' },
      events: [{ code: 'native_file_error', at: '2026-08-22T10:00:00.000Z' }],
      releaseHealth: {
        schemaVersion: 1,
        currentVersion: '1.1.4',
        currentBuild: '6',
      },
      androidProcessHealth: {
        schemaVersion: 1,
        status: 'unsupported',
        minAndroidApi: 30,
      },
    });
    expect(JSON.stringify(report)).not.toContain('token');
    expect(JSON.stringify(report)).not.toContain('raw-secret');
  });

  it('aggregates fixed release-health counters without user content', async () => {
    await startReleaseHealthSession();
    await Promise.all([
      recordReleaseHealthMetric('push_registration_succeeded'),
      recordReleaseHealthMetric('push_received'),
      recordReleaseHealthMetric('offline_recovered'),
    ]);

    const snapshot = await getReleaseHealthSnapshot();
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      currentVersion: '1.1.4',
      currentBuild: '6',
      crashFreeSessionPercent: 100,
      counters: {
        sessions_started: 1,
        push_registration_succeeded: 1,
        push_received: 1,
        offline_recovered: 1,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('message');
    expect(JSON.stringify(snapshot)).not.toContain('token');
  });

  it('serializes concurrent counter updates without losing events', async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => recordReleaseHealthMetric('push_received')),
    );

    expect((await getReleaseHealthSnapshot()).counters.push_received).toBe(10);
  });
});
