import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useVoiceRecorder from './useVoiceRecorder';

const originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const originalIsSecureContextDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

let mediaRecorderInstances = [];
let audioContextInstances = [];

function restoreProperty(target, propertyName, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, propertyName, descriptor);
    return;
  }
  delete target[propertyName];
}

function installSecureMediaEnvironment({ audioContext = true } = {}) {
  const getUserMedia = vi.fn();
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  class MockMediaRecorder {
    static isTypeSupported = vi.fn((mimeType) => mimeType === 'audio/webm;codecs=opus');

    constructor(stream, options = {}) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      this.onerror = null;
      this.start = vi.fn(() => {
        this.state = 'recording';
        this.ondataavailable?.({
          data: new Blob(['voice-data'], { type: options.mimeType || 'audio/webm' }),
        });
      });
      this.stop = vi.fn(() => {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.onstop?.();
      });
      mediaRecorderInstances.push(this);
    }
  }

  vi.stubGlobal('MediaRecorder', MockMediaRecorder);

  if (audioContext) {
    class MockAnalyserNode {
      constructor() {
        this.fftSize = 0;
        this.smoothingTimeConstant = 0;
        this.disconnect = vi.fn();
        this.getByteTimeDomainData = vi.fn((buffer) => {
          buffer.fill(128);
        });
      }
    }

    class MockAudioContext {
      constructor() {
        this.state = 'running';
        this.source = {
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        this.analyser = new MockAnalyserNode();
        this.createMediaStreamSource = vi.fn(() => this.source);
        this.createAnalyser = vi.fn(() => this.analyser);
        this.resume = vi.fn(() => Promise.resolve());
        this.close = vi.fn(() => Promise.resolve());
        audioContextInstances.push(this);
      }
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('webkitAudioContext', undefined);
  } else {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
  }

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

  return { getUserMedia };
}

function createMockStream() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: vi.fn(() => [track]),
  };
  return { stream, track };
}

beforeEach(() => {
  mediaRecorderInstances = [];
  audioContextInstances = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreProperty(navigator, 'mediaDevices', originalMediaDevicesDescriptor);
  restoreProperty(window, 'isSecureContext', originalIsSecureContextDescriptor);
});

describe('useVoiceRecorder', () => {
  it('creates a mic analyser after getUserMedia and cleans resources on cancel', async () => {
    const { getUserMedia } = installSecureMediaEnvironment();
    const { stream, track } = createMockStream();
    getUserMedia.mockResolvedValue(stream);

    const { result } = renderHook(() => useVoiceRecorder({ notifyWarning: vi.fn() }));

    await act(async () => {
      await result.current.startVoiceRecording();
    });

    expect(result.current.voiceRecording).toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(audioContextInstances).toHaveLength(1);
    expect(audioContextInstances[0].createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(audioContextInstances[0].createAnalyser).toHaveBeenCalledTimes(1);
    expect(audioContextInstances[0].source.connect).toHaveBeenCalledWith(audioContextInstances[0].analyser);

    act(() => {
      result.current.cancelVoiceRecording();
    });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(audioContextInstances[0].source.disconnect).toHaveBeenCalledTimes(1);
    expect(audioContextInstances[0].analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(audioContextInstances[0].close).toHaveBeenCalledTimes(1);
    expect(result.current.voiceRecording).toBe(false);
    expect(result.current.voiceRecordingLevelRef.current).toBe(0);
  });

  it('preserves voice file metadata and cleans resources on stop', async () => {
    const { getUserMedia } = installSecureMediaEnvironment();
    const { stream, track } = createMockStream();
    const onRecordingComplete = vi.fn();
    getUserMedia.mockResolvedValue(stream);

    const { result } = renderHook(() => useVoiceRecorder({ onRecordingComplete, notifyWarning: vi.fn() }));

    await act(async () => {
      await result.current.startVoiceRecording();
    });

    act(() => {
      result.current.stopVoiceRecording();
    });

    expect(onRecordingComplete).toHaveBeenCalledTimes(1);
    expect(onRecordingComplete.mock.calls[0][0].file).toBeInstanceOf(File);
    expect(onRecordingComplete.mock.calls[0][0].file.type).toBe('audio/webm;codecs=opus');
    expect(onRecordingComplete.mock.calls[0][0].duration).toBeGreaterThanOrEqual(1);
    expect(onRecordingComplete.mock.calls[0][0].mimeType).toBe('audio/webm;codecs=opus');
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(audioContextInstances[0].close).toHaveBeenCalledTimes(1);
    expect(result.current.voiceRecording).toBe(false);
  });

  it('starts recording without AudioContext support and keeps a quiet level ref', async () => {
    const { getUserMedia } = installSecureMediaEnvironment({ audioContext: false });
    const { stream } = createMockStream();
    getUserMedia.mockResolvedValue(stream);

    const { result } = renderHook(() => useVoiceRecorder({ notifyWarning: vi.fn() }));

    await act(async () => {
      await result.current.startVoiceRecording();
    });

    expect(result.current.voiceRecording).toBe(true);
    expect(audioContextInstances).toHaveLength(0);
    expect(result.current.voiceRecordingLevelRef.current).toBe(0);

    act(() => {
      result.current.cancelVoiceRecording();
    });

    expect(result.current.voiceRecording).toBe(false);
  });
});
