import {
  buildPortalNativeConnectivityScript,
  normalizeNativeConnectivitySnapshot,
} from './nativeConnectivity';

describe('native Android connectivity bridge', () => {
  it('accepts only bounded privacy-safe connectivity data', () => {
    expect(normalizeNativeConnectivitySnapshot({
      online: true,
      connected: true,
      transport: 'wifi',
      metered: false,
      changedAtMs: 1_787_500_000_000,
    })).toEqual({
      available: true,
      online: true,
      connected: true,
      transport: 'wifi',
      metered: false,
      changedAtMs: 1_787_500_000_000,
    });
    expect(normalizeNativeConnectivitySnapshot({
      online: true,
      connected: true,
      transport: 'ssid:secret',
      metered: false,
      changedAtMs: 1_787_500_000_000,
    })).toEqual(expect.objectContaining({ available: false }));
    expect(normalizeNativeConnectivitySnapshot({
      online: true,
      connected: false,
      transport: 'none',
      metered: false,
      changedAtMs: 1_787_500_000_000,
    })).toEqual(expect.objectContaining({ available: false }));
  });

  it('updates only the APK offline flag and emits a bounded DOM event', () => {
    const script = buildPortalNativeConnectivityScript(false);
    expect(script).toContain('__HUBIT_MOBILE_APP__ !== true');
    expect(script).toContain("readOnly = true");
    expect(script).toContain('hubit:mobile-network-state');
    expect(script).toContain("new Event('offline')");
    expect(script).not.toContain('ssid');
    expect(script).not.toContain('content');

    const onlineScript = buildPortalNativeConnectivityScript(true);
    expect(onlineScript).toContain('readOnly = false');
    expect(onlineScript).toContain("new Event('online')");
  });
});
