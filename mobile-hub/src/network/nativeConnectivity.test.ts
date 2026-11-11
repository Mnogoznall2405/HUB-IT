import {
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

});
