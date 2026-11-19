import {
  buildDiagnosticReport,
  clearDiagnosticEvents,
  getDiagnosticEventCount,
  getReleaseHealthSnapshot,
  recordDiagnosticEvent,
  recordSnapshotFailure,
  recordReleaseHealthMetric,
  shareDiagnosticReport,
  startReleaseHealthSession,
} from './diagnostics';
import { getAndroidProcessHealthSnapshot } from './androidProcessHealth';
import { noteRequestEnd, noteRequestStart } from './perfProbes';
import { resetUiTiming } from './uiTiming';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.1.4',
  nativeBuildVersion: '6',
}));

jest.mock('./androidProcessHealth', () => {
  const actual = jest.requireActual('./androidProcessHealth');
  return {
    ...actual,
    getAndroidProcessHealthSnapshot: jest.fn(actual.getAndroidProcessHealthSnapshot),
  };
});

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
      schemaVersion: 8,
      generatedAt: '2026-08-22T11:00:00.000Z',
      privacy: 'no-user-content-no-credentials',
      app: { version: '1.1.4', build: '6' },
      events: [{ code: 'native_file_error', at: '2026-08-22T10:00:00.000Z' }],
      releaseHealth: {
        schemaVersion: 2,
        currentVersion: '1.1.4',
        currentBuild: '6',
      },
      androidProcessHealth: {
        schemaVersion: 2,
        status: 'unsupported',
        minAndroidApi: 30,
      },
      chatSendTiming: { sends: 0 },
      apiInflight: {
        current: 0,
        maxObserved: 0,
        atChatSendHttpStart: { count: 0, p50: null, p95: null },
      },
    });
    expect(report.summary.sections.find((section) => section.id === 'periods')?.lines.join(' '))
      .toContain('может включать предыдущие версии APK');
    expect(JSON.stringify(report)).not.toContain('token');
    expect(JSON.stringify(report)).not.toContain('raw-secret');
  });

  it('exports masked perf endpoints in the shared report, never ids or query', () => {
    resetUiTiming();
    try {
      const own = { method: 'get', url: '/chat/conversations/privateclient/messages?token=secret' };
      const other = { method: 'get', url: '/chat/users/ivan/profile' };
      noteRequestStart(own, 1000);
      noteRequestEnd(own, false, 1200);
      noteRequestStart(other, 2000);
      noteRequestEnd(other, false, 2100);
      const report = buildDiagnosticReport([]);
      expect(report.uiTiming.perf.endpoints['GET /chat/conversations/:id/messages'])
        .toMatchObject({ count: 1, maxMs: 200 });
      expect(report.uiTiming.perf.endpoints['GET /chat/users/:id/profile'])
        .toMatchObject({ count: 1, maxMs: 100 });
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain('privateclient');
      expect(serialized).not.toContain('ivan');
      expect(serialized).not.toContain('token=secret');
    } finally {
      resetUiTiming();
    }
  });

  it('keeps bounded diagnostic context on record and drops forged fields on export', async () => {
    await recordDiagnosticEvent('native_file_error', undefined, { source: 'chat-outbox', stage: 'parse' });
    await recordDiagnosticEvent('native_chat_delivery_error', undefined, {
      source: 'chat-delivery', stage: 'background',
    });
    // A context carrying anything outside the fixed sets never reaches storage.
    await recordDiagnosticEvent('native_file_error', undefined, {
      source: 'chat-outbox;name=ivan-private' as never,
      stage: 'parse',
    });
    await recordDiagnosticEvent('ui_render_error', undefined, { source: 'chat-outbox', stage: 'parse' });

    const stored = JSON.parse((await SecureStore.getItemAsync('hubit_diagnostics_v1')) || '[]');
    expect(stored).toEqual([
      expect.objectContaining({
        code: 'native_file_error', context: { source: 'chat-outbox', stage: 'parse' },
      }),
      expect.objectContaining({
        code: 'native_chat_delivery_error', context: { source: 'chat-delivery', stage: 'background' },
      }),
      expect.objectContaining({ code: 'native_file_error' }),
      expect.objectContaining({ code: 'ui_render_error' }),
    ]);
    expect(stored[2].context).toBeUndefined();
    expect(stored[3].context).toBeUndefined();

    // A forged context written into storage directly must be revalidated out
    // of the exported report — never trusted from disk.
    stored.push({
      code: 'native_file_error',
      at: '2026-08-22T10:00:00.000Z',
      context: { source: 'chat-outbox;token=synthetic-secret', stage: 'parse' },
    });
    const report = buildDiagnosticReport(stored);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('ivan');
    expect(serialized).not.toContain('token=synthetic-secret');
    expect(serialized).not.toContain('synthetic-secret');
    expect(report.events).toContainEqual(
      expect.objectContaining({
        code: 'native_chat_delivery_error',
        context: { source: 'chat-delivery', stage: 'background' },
      }),
    );
    expect(report.events[4]).toEqual({
      code: 'native_file_error', at: '2026-08-22T10:00:00.000Z',
    });
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
      schemaVersion: 2,
      currentVersion: '1.1.4',
      currentBuild: '6',
      counters: {
        sessions_started: 1,
        push_registration_succeeded: 1,
        push_received: 1,
        offline_recovered: 1,
      },
    });
    expect(snapshot.currentBuildFirstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(snapshot)).not.toContain('crashFreeSessionPercent');
    expect(JSON.stringify(snapshot)).not.toContain('message');
    expect(JSON.stringify(snapshot)).not.toContain('token');
  });

  it('stamps the build boundary when the running build changes and keeps old counters', async () => {
    // The start-of-session flag is process-local: a fresh module instance is
    // required to simulate the first launch of build 6 over stored build 5 data.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const freshDiagnostics = require('./diagnostics') as typeof import('./diagnostics');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const freshStore = require('expo-secure-store') as typeof import('expo-secure-store');
    await freshStore.setItemAsync('hubit_release_health_v1', JSON.stringify({
      periodStartedAt: '2026-08-20T08:00:00.000Z',
      lastVersion: '1.1.3',
      lastBuild: '5',
      currentBuildFirstSeenAt: '2026-08-21T09:00:00.000Z',
      counters: { sessions_started: 3, ui_failures: 1, push_received: 4 },
    }));

    // While the stored record still describes build 5, the boundary it carries
    // belongs to that build and must not be reported as build 6's first sighting.
    expect((await freshDiagnostics.getReleaseHealthSnapshot()).currentBuildFirstSeenAt).toBeNull();

    await freshDiagnostics.startReleaseHealthSession();
    const snapshot = await freshDiagnostics.getReleaseHealthSnapshot();
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.currentBuildFirstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.currentBuildFirstSeenAt).not.toBe('2026-08-21T09:00:00.000Z');
    expect(snapshot.counters).toMatchObject({
      sessions_started: 4,
      ui_failures: 1,
      push_received: 4,
      update_completed: 1,
    });
  });

  it('passes the release build boundary to native exit history when sharing', async () => {
    await SecureStore.setItemAsync('hubit_release_health_v1', JSON.stringify({
      lastVersion: '1.1.4',
      lastBuild: '6',
      currentBuildFirstSeenAt: '2026-08-22T09:00:00.000Z',
      counters: { sessions_started: 2 },
    }));
    jest.mocked(getAndroidProcessHealthSnapshot).mockResolvedValue({
      schemaVersion: 2,
      status: 'available',
      minAndroidApi: 30,
      historyLimit: 20,
      latestAt: null,
      counts: {
        anr: 0, crash: 0, nativeCrash: 0, lowMemory: 0,
        excessiveResource: 0, otherUnexpected: 0, expected: 0,
      },
      sinceCurrentBuildFirstSeen: {
        at: '2026-08-22T09:00:00.000Z',
        counts: {
          anr: 0, crash: 0, nativeCrash: 0, lowMemory: 0,
          excessiveResource: 0, otherUnexpected: 0, expected: 0,
        },
      },
      recent: [],
    });
    const write = jest.fn();
    jest.mocked(File).mockImplementationOnce(() => ({
      uri: 'file:///cache/hubit-diagnostics-test.json',
      create: jest.fn(),
      write,
      exists: false,
      delete: jest.fn(),
    } as unknown as File));

    await shareDiagnosticReport();

    expect(jest.mocked(getAndroidProcessHealthSnapshot))
      .toHaveBeenCalledWith('2026-08-22T09:00:00.000Z');
    const shared = JSON.parse(String(write.mock.calls[0]?.[0]));
    expect(shared.summary.sections.find((section: { id: string }) => section.id === 'android').lines.join(' '))
      .toContain('После первого наблюдения этой сборки (2026-08-22T09:00:00.000Z)');
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
