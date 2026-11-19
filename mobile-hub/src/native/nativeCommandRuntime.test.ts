import { writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import { clearDiagnosticEvents, recordDiagnosticEvent } from '../diagnostics/diagnostics';
import { assertAppLockPayload, executeNativeCommand } from './nativeCommandRuntime';

describe('nativeCommandRuntime', () => {
  it('accepts only known app-lock timeouts', () => {
    expect(assertAppLockPayload({ enabled: true, timeoutSeconds: 60 })).toEqual({
      enabled: true,
      timeoutSeconds: 60,
    });
    expect(() => assertAppLockPayload({ enabled: true, timeoutSeconds: 12 })).toThrow('Invalid app lock timeout');
  });

  it('reports which native screens are ready for offline reading', async () => {
    await writeNativeSnapshot('mail-inbox', 17, {
      items: [{ id: 'mail-1' }],
      total: 1,
      hasMore: false,
    });

    const state = await executeNativeCommand('offline.getState', {}, {
      user: { id: 17, username: 'offline-user' } as never,
      biometricEnabled: false,
      enableBiometrics: jest.fn(),
      skipBiometrics: jest.fn(),
      updater: {} as never,
    }) as Record<string, unknown>;

    expect(state).toEqual(expect.objectContaining({
      snapshotReady: true,
      snapshotScopes: ['mail-inbox'],
    }));
    expect(Number(state.snapshotLastSyncAt)).toBeGreaterThan(0);
  });

  it('does not report complete offline readiness when a permitted core module is missing', async () => {
    await writeNativeSnapshot('mail-inbox', 18, {
      items: [{ id: 'mail-1' }],
      total: 1,
      hasMore: false,
    });

    const state = await executeNativeCommand('offline.getState', {}, {
      user: {
        id: 18,
        username: 'partial-offline-user',
        permissions: ['mail.access', 'tasks.read'],
      } as never,
      biometricEnabled: false,
      enableBiometrics: jest.fn(),
      skipBiometrics: jest.fn(),
      updater: {} as never,
    }) as Record<string, unknown>;

    expect(state).toEqual(expect.objectContaining({
      snapshotReady: false,
      snapshotScopes: ['mail-inbox'],
      snapshotMissingScopes: ['tasks-inbox', 'notifications'],
    }));
  });

  it('does not count an address-book manifest with a missing shard as offline-ready', async () => {
    await writeNativeSnapshot('address-book', 19, {
      kind: 'address-book-shards-v1',
      revision: 'broken-revision',
      metadata: { total: 1 },
      itemCount: 1,
      shards: [{ scope: 'address-book-shard-broken-revision-0', count: 1 }],
    });

    const state = await executeNativeCommand('offline.getState', {}, {
      user: {
        id: 19,
        username: 'broken-address-book-user',
        permissions: ['address_book.read'],
      } as never,
      biometricEnabled: false,
      enableBiometrics: jest.fn(),
      skipBiometrics: jest.fn(),
      updater: {} as never,
    }) as Record<string, unknown>;

    expect(state).toEqual(expect.objectContaining({
      snapshotReady: false,
      snapshotScopes: [],
      snapshotMissingScopes: ['address-book'],
    }));
  });

  it('feeds stored diagnostic events into the summary section', async () => {
    await clearDiagnosticEvents();
    await recordDiagnosticEvent('native_file_error', undefined, { source: 'chat-outbox', stage: 'parse' });

    const state = await executeNativeCommand('diagnostics.getState', {}, {
      user: { id: 17, username: 'diagnostic-user' } as never,
      biometricEnabled: false,
      enableBiometrics: jest.fn(),
      skipBiometrics: jest.fn(),
      updater: {} as never,
    }) as {
      eventCount: number;
      summary: { sections: Array<{ id: string; lines: string[] }> };
    };

    expect(state.eventCount).toBe(1);
    expect(state.summary.sections.find((section) => section.id === 'events')?.lines.join(' '))
      .toContain('Ошибка локального файла (очередь чата, чтение)');
  });
});
