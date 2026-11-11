// Thin wrapper around livekit-client. Loaded lazily so the SDK stays out of the
// main bundle until the first call. Exposes a small imperative handle plus
// plain-object snapshots, so React state never holds SDK classes except the
// Track objects that <video> elements attach to.
//
// Invariant: at most one LiveKit room per tab. Every room is registered from the
// moment it is created (not when connect/publish finished), so a teardown that
// happens mid-connect still reaches it, and a new call first awaits the
// disconnect of anything left over.

import { isRouteChunkLoadError } from '../../../lib/routeChunkRecovery';
import { callLog } from './callsLog';
import { describeMediaFailure } from './callsModel';
import { countInputDevices } from './micProbe';

// Local tracks normally publish in < 2 s; a hung getUserMedia/publish must not
// keep the session half-built (and the room unreleasable) forever.
export const LOCAL_TRACK_TIMEOUT_MS = 15_000;

const liveRooms = new Set();

export class CallConnectError extends Error {
  constructor(stage, code, cause) {
    super(`call ${stage} failed: ${code}`);
    this.name = 'CallConnectError';
    this.stage = stage; // 'import' | 'connect' | 'aborted'
    this.code = code;
    this.cause = cause;
  }
}

export async function disconnectAllCallRooms(reason = '') {
  const pending = Array.from(liveRooms);
  if (!pending.length) return;
  callLog('teardown:all', { reason, rooms: pending.length });
  await Promise.all(pending.map((handle) => handle.disconnect(reason)));
}

export const getLiveCallRoomCount = () => liveRooms.size;

async function loadLiveKit() {
  try {
    const module = await import('livekit-client');
    callLog('livekit:import:ok');
    return module;
  } catch (error) {
    const chunk = isRouteChunkLoadError(error);
    callLog('livekit:import:fail', { chunk, name: error?.name || 'Error' });
    throw new CallConnectError('import', chunk ? 'chunk_load' : String(error?.name || 'import_failed'), error);
  }
}

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    const error = new Error('local track timeout');
    error.name = 'TimeoutError';
    reject(error);
  }, ms);
  Promise.resolve(promise).then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    },
  );
});

export async function connectCallRoom({
  url,
  token,
  media,
  callId = '',
  micDeviceId = '',
  cameraDeviceId = '',
  skipMicrophone = false,
  initialMicIssue = null,
  onCreated,
  onChange,
  onDisconnected,
}) {
  const livekit = await loadLiveKit();
  const { Room, RoomEvent, Track, ConnectionState, DisconnectReason } = livekit;

  // Never two rooms at once: finish whatever is still around first.
  await disconnectAllCallRooms('new-room');

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  let closed = false;
  let disconnectPromise = null;
  let micIssue = skipMicrophone ? (initialMicIssue || { errorName: 'NotFoundError', inputCount: 0 }) : null;
  let devicesVersion = 0;
  const audioElements = new Map();

  const attachAudio = (track) => {
    if (track.kind !== Track.Kind.Audio) return;
    const element = track.attach();
    element.style.display = 'none';
    document.body.appendChild(element);
    audioElements.set(track, element);
  };
  const detachAudio = (track) => {
    if (track.kind !== Track.Kind.Audio) return;
    track.detach().forEach((element) => element.remove());
    audioElements.delete(track);
  };
  const dropAllAudio = () => {
    audioElements.forEach((element) => element.remove());
    audioElements.clear();
  };

  const buildParticipant = (participant, isLocal) => {
    const camera = participant.getTrackPublication(Track.Source.Camera);
    const screen = participant.getTrackPublication(Track.Source.ScreenShare);
    const mic = participant.getTrackPublication(Track.Source.Microphone);
    return {
      identity: participant.identity,
      name: participant.name || '',
      isLocal,
      isSpeaking: Boolean(participant.isSpeaking),
      micEnabled: Boolean(mic && !mic.isMuted),
      cameraTrack: camera && !camera.isMuted && camera.track ? camera.track : null,
      screenTrack: screen && screen.track ? screen.track : null,
    };
  };

  const resolveConnection = () => {
    switch (room.state) {
      case ConnectionState.Connected: return 'connected';
      case ConnectionState.Reconnecting:
      case ConnectionState.SignalReconnecting: return 'reconnecting';
      case ConnectionState.Disconnected: return 'disconnected';
      default: return 'connecting';
    }
  };

  const buildSnapshot = () => {
    const local = room.localParticipant;
    return {
      connection: resolveConnection(),
      micEnabled: Boolean(local.isMicrophoneEnabled),
      cameraEnabled: Boolean(local.isCameraEnabled),
      screenEnabled: Boolean(local.isScreenShareEnabled),
      audioBlocked: !room.canPlaybackAudio,
      micIssue,
      devicesVersion,
      participants: [
        buildParticipant(local, true),
        ...Array.from(room.remoteParticipants.values()).map((item) => buildParticipant(item, false)),
      ],
    };
  };

  const emit = () => {
    if (closed) return;
    onChange?.(buildSnapshot());
  };

  // Returns an Error on failure (so the caller can show a RU message), null on success.
  const run = async (action) => {
    try {
      await action();
      return null;
    } catch (error) {
      return error || new Error('media error');
    } finally {
      emit();
    }
  };

  // Opens the device; a remembered/probed deviceId that no longer works must not
  // block the call, so it falls back to the system default once.
  const captureWithFallback = async (enable, deviceId) => {
    try {
      await withTimeout(enable(deviceId ? { deviceId } : undefined), LOCAL_TRACK_TIMEOUT_MS);
    } catch (error) {
      if (!deviceId || closed) throw error;
      await withTimeout(enable(undefined), LOCAL_TRACK_TIMEOUT_MS);
    }
  };

  const handle = {
    warnings: [],
    getSnapshot: buildSnapshot,
    setMicrophoneEnabled: (enabled) => run(() => room.localParticipant.setMicrophoneEnabled(enabled)),
    setCameraEnabled: (enabled) => run(() => room.localParticipant.setCameraEnabled(enabled)),
    setScreenShareEnabled: (enabled) => run(() => room.localParticipant.setScreenShareEnabled(enabled)),
    resumeAudio: () => run(() => room.startAudio()),
    // Mic could not be opened at join time (or was skipped): try again, optionally on a chosen device.
    enableMicrophone: async (deviceId) => {
      const error = await run(() => captureWithFallback(
        (options) => room.localParticipant.setMicrophoneEnabled(true, options),
        deviceId,
      ));
      if (!error) micIssue = null;
      emit();
      return error;
    },
    setMicIssue: (issue) => {
      micIssue = issue;
      emit();
    },
    listDevices: async (kind) => {
      try {
        const devices = await Room.getLocalDevices(kind, false);
        return {
          devices: devices
            .filter((device) => device.deviceId)
            .map((device) => ({ deviceId: device.deviceId, label: String(device.label || '') })),
          activeId: String(room.getActiveDevice(kind) || ''),
        };
      } catch {
        return { devices: [], activeId: '' };
      }
    },
    switchDevice: async (kind, deviceId) => {
      if (kind === 'audioinput' && micIssue) {
        const error = await run(() => captureWithFallback(
          (options) => room.localParticipant.setMicrophoneEnabled(true, options),
          deviceId,
        ));
        if (!error) micIssue = null;
        emit();
        return error;
      }
      return run(async () => {
        const switched = await room.switchActiveDevice(kind, deviceId);
        if (switched === false) throw new Error('device switch failed');
      });
    },
    // Idempotent: concurrent callers share one disconnect; resolves once the
    // room has left and the tracks are stopped.
    disconnect: (reason = '') => {
      if (!disconnectPromise) {
        closed = true;
        dropAllAudio();
        callLog('room:disconnect', { callId, reason });
        disconnectPromise = (async () => {
          try {
            await room.disconnect(true);
          } catch {
            // Already closed.
          } finally {
            liveRooms.delete(handle);
          }
        })();
      }
      return disconnectPromise;
    },
  };
  liveRooms.add(handle);

  [
    RoomEvent.ParticipantConnected,
    RoomEvent.ParticipantDisconnected,
    RoomEvent.ParticipantNameChanged,
    RoomEvent.TrackPublished,
    RoomEvent.TrackUnpublished,
    RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted,
    RoomEvent.LocalTrackPublished,
    RoomEvent.LocalTrackUnpublished,
    RoomEvent.ActiveSpeakersChanged,
    RoomEvent.ConnectionStateChanged,
    RoomEvent.Reconnecting,
    RoomEvent.Reconnected,
    RoomEvent.AudioPlaybackStatusChanged,
    RoomEvent.ActiveDeviceChanged,
  ].forEach((eventName) => room.on(eventName, emit));
  // Headsets plugged in after the call started must show up in the device menu.
  room.on(RoomEvent.MediaDevicesChanged, () => {
    devicesVersion += 1;
    emit();
  });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    attachAudio(track);
    emit();
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    detachAudio(track);
    emit();
  });
  room.on(RoomEvent.MediaDevicesError, (error) => {
    onChange?.({
      ...buildSnapshot(),
      deviceError: {
        ...describeMediaFailure(error?.name, 'microphone'),
      },
    });
  });
  room.on(RoomEvent.Disconnected, (reason) => {
    const reasonName = DisconnectReason?.[reason] || String(reason ?? '');
    callLog('room:disconnected', { callId, reason: reasonName, local: closed });
    dropAllAudio();
    if (closed) return;
    // Server/network side: release local tracks too.
    void handle.disconnect(`remote:${reasonName}`);
    onDisconnected?.({
      reason: reasonName,
      duplicateIdentity: reason === DisconnectReason?.DUPLICATE_IDENTITY,
    });
  });

  // Teardown may happen from now on, even before connect() resolves.
  onCreated?.(handle);
  const assertOpen = () => {
    if (closed) throw new CallConnectError('aborted', 'aborted');
  };

  try {
    assertOpen();
    await room.connect(url, token);
    callLog('room:connect:ok', { callId });
  } catch (error) {
    if (error instanceof CallConnectError) throw error;
    const abortedByTeardown = closed;
    const code = String(error?.name || 'Error') + (error?.reason != null ? `:${error.reason}` : '');
    callLog('room:connect:fail', { callId, code, aborted: abortedByTeardown });
    await handle.disconnect('connect-failed');
    throw abortedByTeardown
      ? new CallConnectError('aborted', 'aborted', error)
      : new CallConnectError('connect', code, error);
  }
  assertOpen();

  const failureOf = async (error, device) => {
    const inputCount = await countInputDevices(device === 'camera' ? 'videoinput' : 'audioinput');
    return { device, errorName: String(error?.name || 'Error'), inputCount };
  };

  if (!skipMicrophone) {
    try {
      await captureWithFallback(
        (options) => room.localParticipant.setMicrophoneEnabled(true, options),
        micDeviceId,
      );
    } catch (error) {
      assertOpen();
      const failure = await failureOf(error, 'microphone');
      handle.warnings.push(failure);
      micIssue = { errorName: failure.errorName, inputCount: failure.inputCount };
    }
  }
  assertOpen();
  if (media === 'video') {
    try {
      await captureWithFallback(
        (options) => room.localParticipant.setCameraEnabled(true, options),
        cameraDeviceId,
      );
    } catch (error) {
      assertOpen();
      handle.warnings.push(await failureOf(error, 'camera'));
    }
  }
  assertOpen();
  emit();
  return handle;
}
