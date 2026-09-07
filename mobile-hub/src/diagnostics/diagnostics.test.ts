import {
  buildDiagnosticReport,
  clearDiagnosticEvents,
  getDiagnosticEventCount,
  getReleaseHealthSnapshot,
  recordDiagnosticEvent,
  recordSnapshotFailure,
  recordReleaseHealthMetric,
  startReleaseHealthSession,
} from './diagnostics';
import * as SecureStore from 'expo-secure-store';

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

  it('keeps concurrent snapshot stages and metadata while excluding private exception content', async () => {
    const privateValue = 'Иванов Иван, test-person@example.test, token=synthetic-secret';
    const error = new TypeError(`Call to FileSystemFile.text: ${privateValue}`);
    error.stack = `TypeError: ${privateValue}\n    at readSnapshot (file:///private/${privateValue}/index.js:10:22)`;
    await Promise.all(Array.from({ length: 8 }, () => recordSnapshotFailure('address-book-shard-private-revision', 'pending-read', error, {
      sizes: { readChars: 0, encodedChars: 500 }, files: { pending: { exists: true, size: 500 } },
    })));
    expect(await getDiagnosticEventCount()).toBe(8);
    const events = JSON.parse((await SecureStore.getItemAsync('hubit_diagnostics_v1')) || '[]');
    const report = buildDiagnosticReport(events);
    expect(report.events[0].snapshot).toMatchObject({
      scope: 'address-book-shard', stage: 'pending-read', errorType: 'TypeError',
      message: 'FileSystemFile.text', stack: 'at readSnapshot (<source>:10:22)',
      sizes: { readChars: 0, encodedChars: 500 }, files: { pending: { exists: true, size: 500 } },
    });
    for (const sensitive of [privateValue, 'Иванов', 'test-person', 'synthetic-secret', 'private-revision', 'file:///']) {
      expect(JSON.stringify(report)).not.toContain(sensitive);
    }
  });

  it('removes the ciphertext argument from native converter errors before storing or sharing', async () => {
    const error = Object.assign(new Error("[fromCombined] Cannot convert 'SYNTHETIC_CIPHERTEXT_NOT_FOR_LOGS' to a Kotlin type. Value is a string, expected an Object"), { code: 'E_UNEXPECTED' });
    await recordSnapshotFailure('dashboard', 'sealed-decode', error);
    const stored = (await SecureStore.getItemAsync('hubit_diagnostics_v1')) || '[]';
    expect(stored).not.toContain('SYNTHETIC_CIPHERTEXT_NOT_FOR_LOGS');
    const report = buildDiagnosticReport(JSON.parse(stored));
    expect(report.events[0].snapshot).toMatchObject({
      errorCode: 'E_UNEXPECTED',
      message: '[fromCombined] Cannot convert [redacted] to a Kotlin type; expected an Object (Uint8Array)',
    });
  });
});
