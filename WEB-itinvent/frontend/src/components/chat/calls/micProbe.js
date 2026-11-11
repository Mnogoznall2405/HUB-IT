// Reliable microphone probe + remembered device choice for calls.
// Pure of React; media APIs are injectable so the ordering rules stay testable.

const RETRYABLE = new Set(['NotReadableError', 'AbortError', 'TrackStartError']);
const MISSING = new Set(['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError']);
const DENIED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);

const STORAGE_PREFIX = 'hubit_chat_call_device_';

const defaultWait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export function readStoredDeviceId(kind) {
  try {
    return String(window.localStorage.getItem(`${STORAGE_PREFIX}${kind}`) || '');
  } catch {
    return '';
  }
}

export function storeDeviceId(kind, deviceId) {
  try {
    if (deviceId) window.localStorage.setItem(`${STORAGE_PREFIX}${kind}`, String(deviceId));
    else window.localStorage.removeItem(`${STORAGE_PREFIX}${kind}`);
  } catch {
    // Storage may be blocked; the choice then lasts for this call only.
  }
}

export async function countInputDevices(kind = 'audioinput', mediaDevices = globalThis.navigator?.mediaDevices) {
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === kind).length;
  } catch {
    return 0;
  }
}

async function openOnce(mediaDevices, audio) {
  try {
    const stream = await mediaDevices.getUserMedia({ audio });
    const tracks = stream.getTracks();
    const audioTrack = (stream.getAudioTracks ? stream.getAudioTracks() : tracks)[0];
    const deviceId = String(audioTrack?.getSettings?.().deviceId || '');
    // The probe must never keep the device: LiveKit opens it again right after.
    tracks.forEach((track) => track.stop());
    return { ok: true, deviceId };
  } catch (error) {
    return { ok: false, errorName: String(error?.name || 'Error') };
  }
}

/**
 * Opens the microphone once and releases it.
 * Order: remembered device -> system default (retrying while the device is
 * still being released, typical for Bluetooth/exclusive mode) -> every
 * audioinput by exact deviceId. A permission refusal stops the search at once.
 * Returns { ok, deviceId, errorName, inputCount }.
 */
export async function probeMicrophone({
  mediaDevices = globalThis.navigator?.mediaDevices,
  preferredDeviceId = '',
  retryDelayMs = 400,
  maxRetries = 2,
  wait = defaultWait,
} = {}) {
  if (!mediaDevices?.getUserMedia) {
    return { ok: false, deviceId: '', errorName: 'InsecureContextError', inputCount: 0 };
  }
  const finish = async (result) => ({
    ok: Boolean(result.ok),
    deviceId: result.deviceId || '',
    errorName: result.errorName || '',
    inputCount: await countInputDevices('audioinput', mediaDevices),
  });

  if (preferredDeviceId) {
    const preferred = await openOnce(mediaDevices, { deviceId: { exact: preferredDeviceId } });
    if (preferred.ok || DENIED.has(preferred.errorName)) return finish(preferred);
  }

  let result = await openOnce(mediaDevices, true);
  for (let attempt = 0; attempt < maxRetries && !result.ok && RETRYABLE.has(result.errorName); attempt += 1) {
    await wait(retryDelayMs);
    result = await openOnce(mediaDevices, true);
  }
  if (result.ok || !(MISSING.has(result.errorName) || RETRYABLE.has(result.errorName))) {
    return finish(result);
  }

  let inputs = [];
  try {
    inputs = (await mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'audioinput' && device.deviceId);
  } catch {
    inputs = [];
  }
  const tried = new Set(preferredDeviceId ? [preferredDeviceId] : []);
  for (const device of inputs) {
    if (tried.has(device.deviceId)) continue;
    tried.add(device.deviceId);
    const attempt = await openOnce(mediaDevices, { deviceId: { exact: device.deviceId } });
    if (attempt.ok) return finish({ ok: true, deviceId: attempt.deviceId || device.deviceId });
    if (DENIED.has(attempt.errorName)) return finish(attempt);
  }
  return finish(result);
}
