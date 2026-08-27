import { writeNativeSnapshot } from '../cache/nativeSnapshotCache';
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
    await writeNativeSnapshot('mail-inbox', 17, { items: [{ id: 'mail-1' }] });

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
});
