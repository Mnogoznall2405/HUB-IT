import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import type { NativePickedFile } from '../files/nativeFilePicker';
import { meteringToVoiceLevel, normalizeVoiceDurationSeconds, VOICE_MIME_TYPE, voiceFileName } from './chatVoice';

export class NativeMicrophonePermissionError extends Error {
  readonly canAskAgain: boolean;

  constructor(canAskAgain: boolean) {
    super('Для записи голоса нужно разрешение Android');
    this.name = 'NativeMicrophonePermissionError';
    this.canAskAgain = canAskAgain;
  }
}

const VOICE_METER_INTERVAL_MS = 80;
const VOICE_IDLE_INTERVAL_MS = 60_000;

export function useNativeVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const recorderState = useAudioRecorderState(
    recorder,
    recording ? VOICE_METER_INTERVAL_MS : VOICE_IDLE_INTERVAL_MS,
  );
  const [duration, setDuration] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (recording) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new NativeMicrophonePermissionError(Boolean(permission.canAskAgain));
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    await recorder.prepareToRecordAsync({
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    });
    recorder.record();
    startedAtRef.current = Date.now();
    setRecording(true);
    setDuration(0);
    clearTimer();
    timerRef.current = setInterval(() => {
      if (startedAtRef.current) {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 200);
  }, [recorder, recording]);

  const stop = useCallback(async (): Promise<NativePickedFile | null> => {
    if (!recording) return null;
    clearTimer();
    await recorder.stop();
    const elapsed = startedAtRef.current
      ? (Date.now() - startedAtRef.current) / 1000
      : recorder.currentTime;
    startedAtRef.current = null;
    setRecording(false);
    setDuration(0);
    const uri = String(recorder.uri || '').trim();
    if (!uri) return null;
    let size = 1;
    try {
      size = Math.max(1, Number(new File(uri).size || 0));
    } catch {
      size = 1;
    }
    return {
      uri,
      name: voiceFileName(),
      mimeType: VOICE_MIME_TYPE,
      size,
      source: 'voice',
    };
  }, [recorder, recording]);

  const cancel = useCallback(async () => {
    clearTimer();
    startedAtRef.current = null;
    setRecording(false);
    setDuration(0);
    if (recorder.isRecording) {
      try {
        await recorder.stop();
      } catch {
        // ignore cancel failures
      }
    }
  }, [recorder]);

  return {
    voiceRecording: recording || recorderState.isRecording,
    voiceRecordingDuration: recording
      ? Math.max(duration, Math.round(Number(recorderState.durationMillis || 0) / 1000))
      : 0,
    voiceRecordingLevel: recorderState.metering == null
      ? null
      : meteringToVoiceLevel(recorderState.metering),
    startVoiceRecording: start,
    stopVoiceRecording: stop,
    cancelVoiceRecording: cancel,
    normalizeDuration: normalizeVoiceDurationSeconds,
  };
}
