import { Platform } from 'react-native';
import HubitDeviceHealthModule, {
  type HubitAndroidConnectivityResult,
} from '../../modules/hubit-device-health';

export const MOBILE_NATIVE_NETWORK_STATE_EVENT = 'hubit:mobile-network-state';

const TRANSPORTS = [
  'none',
  'wifi',
  'cellular',
  'ethernet',
  'vpn',
  'bluetooth',
  'other',
] as const;

type NativeConnectivityTransport = (typeof TRANSPORTS)[number];

export type NativeConnectivitySnapshot = {
  available: boolean;
  online: boolean;
  connected: boolean;
  transport: NativeConnectivityTransport;
  metered: boolean;
  changedAtMs: number;
};

const unavailableSnapshot = (): NativeConnectivitySnapshot => ({
  available: false,
  online: false,
  connected: false,
  transport: 'none',
  metered: false,
  changedAtMs: 0,
});

export function normalizeNativeConnectivitySnapshot(
  raw: HubitAndroidConnectivityResult | Record<string, unknown> | null | undefined,
): NativeConnectivitySnapshot {
  if (!raw || typeof raw !== 'object') return unavailableSnapshot();
  const transport = String(raw.transport || '').trim();
  const changedAtMs = Number(raw.changedAtMs || 0);
  if (
    typeof raw.online !== 'boolean'
    || typeof raw.connected !== 'boolean'
    || typeof raw.metered !== 'boolean'
    || (raw.online && !raw.connected)
    || !TRANSPORTS.includes(transport as NativeConnectivityTransport)
    || !Number.isFinite(changedAtMs)
    || changedAtMs <= 0
  ) return unavailableSnapshot();
  return {
    available: true,
    online: raw.online,
    connected: raw.connected,
    transport: transport as NativeConnectivityTransport,
    metered: raw.metered,
    changedAtMs,
  };
}

export function buildPortalNativeConnectivityScript(online: boolean): string {
  const eventName = JSON.stringify(MOBILE_NATIVE_NETWORK_STATE_EVENT);
  const browserEvent = online ? 'online' : 'offline';
  return `
(function () {
  if (window.__HUBIT_MOBILE_APP__ !== true) return;
  var session = window.__HUBIT_MOBILE_OFFLINE_SESSION__;
  if (session && typeof session === 'object') session.readOnly = ${online ? 'false' : 'true'};
  try { window.dispatchEvent(new Event('${browserEvent}')); } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent(${eventName}, {
      detail: { online: ${online ? 'true' : 'false'}, source: 'android' }
    }));
  } catch (_) {}
})();
true;
`;
}

export async function getNativeConnectivitySnapshot(): Promise<NativeConnectivitySnapshot> {
  if (
    Platform.OS !== 'android'
    || !HubitDeviceHealthModule
    || typeof HubitDeviceHealthModule.getConnectivityAsync !== 'function'
  ) return unavailableSnapshot();
  try {
    return normalizeNativeConnectivitySnapshot(
      await HubitDeviceHealthModule.getConnectivityAsync(),
    );
  } catch {
    return unavailableSnapshot();
  }
}

export function subscribeNativeConnectivity(
  listener: (snapshot: NativeConnectivitySnapshot) => void,
): { remove(): void } {
  if (
    Platform.OS !== 'android'
    || !HubitDeviceHealthModule
    || typeof HubitDeviceHealthModule.addListener !== 'function'
    || typeof HubitDeviceHealthModule.getConnectivityAsync !== 'function'
  ) return { remove() {} };
  let active = true;
  let latestChangedAtMs = 0;
  const publish = (raw: HubitAndroidConnectivityResult) => {
    if (!active) return;
    const snapshot = normalizeNativeConnectivitySnapshot(raw);
    if (!snapshot.available || snapshot.changedAtMs < latestChangedAtMs) return;
    latestChangedAtMs = snapshot.changedAtMs;
    listener(snapshot);
  };
  const subscription = HubitDeviceHealthModule.addListener('onConnectivityChanged', publish);
  void HubitDeviceHealthModule.getConnectivityAsync().then(publish).catch(() => undefined);
  return {
    remove() {
      active = false;
      subscription.remove();
    },
  };
}
