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
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const activeRef = useRef(false);
  const preparedRef = useRef(false);
  const startingRef = useRef<Promise<boolean> | null>(null);
  const stoppingRef = useRef<Promise<(NativePickedFile & { durationSeconds: number }) | null> | null>(null);
  const cancellingRef = useRef<Promise<void> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const cancel = useCallback((): Promise<void> => {
    generationRef.current += 1;
    clearTimer();
    startedAtRef.current = null;
    activeRef.current = false;
    if (mountedRef.current) { setRecording(false); setDuration(0); }
    if (cancellingRef.current) return cancellingRef.current;
    const start = startingRef.current;
    const stop = stoppingRef.current;
    const operation = (async () => {
      // Native preparation cannot be aborted. Invalidate first, then dispose it
      // before another start may acquire this recorder.
      await start?.catch(() => undefined);
      await stop?.catch(() => undefined);
      if (preparedRef.current) {
        try { await recorder.stop(); } catch { /* Native resource may already be released. */ }
        preparedRef.current = false;
        const uri = String(recorder.uri || '').trim();
        if (uri) { try { new File(uri).delete(); } catch { /* Best effort orphan cleanup. */ } }
      }
    })().finally(() => { if (cancellingRef.current === operation) cancellingRef.current = null; });
    cancellingRef.current = operation;
    return operation;
  }, [recorder]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; void cancel(); };
  }, [cancel]);

  const start = useCallback((): Promise<boolean> => {
    if (startingRef.current) return startingRef.current;
    if (!mountedRef.current || activeRef.current || stoppingRef.current || cancellingRef.current) return Promise.resolve(false);
    const generation = generationRef.current;
    const current = () => mountedRef.current && generation === generationRef.current;
    const operation = (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!current()) return false;
      if (!permission.granted) throw new NativeMicrophonePermissionError(Boolean(permission.canAskAgain));
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!current()) return false;
      await recorder.prepareToRecordAsync({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
      preparedRef.current = true;
      if (!current()) return false;
      recorder.record();
      activeRef.current = true;
      startedAtRef.current = Date.now();
      setRecording(true);
      setDuration(0);
      clearTimer();
      timerRef.current = setInterval(() => {
        if (current() && startedAtRef.current !== null) setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 200);
      return true;
    })().catch(async (cause) => {
      if (current() && preparedRef.current) {
        try { await recorder.stop(); } catch { /* Best effort release after failed start. */ }
        preparedRef.current = false;
        const uri = String(recorder.uri || '').trim();
        if (uri) { try { new File(uri).delete(); } catch { /* Best effort orphan cleanup. */ } }
      }
      throw cause;
    }).finally(() => { if (startingRef.current === operation) startingRef.current = null; });
    startingRef.current = operation;
    return operation;
  }, [recorder]);

  const stop = useCallback((): Promise<(NativePickedFile & { durationSeconds: number }) | null> => {
    // A voice file is handed off once. Sharing a stop promise with two callers
    // would send the same recording twice under two message IDs.
    if (!mountedRef.current || stoppingRef.current || cancellingRef.current) return Promise.resolve(null);
    const generation = generationRef.current;
    const current = () => mountedRef.current && generation === generationRef.current;
    const operation = (async () => {
      await startingRef.current;
      if (!current() || !activeRef.current) return null;
      await recorder.stop();
      if (!current()) return null;
      activeRef.current = false;
      preparedRef.current = false;
      clearTimer();
      const elapsed = startedAtRef.current !== null ? (Date.now() - startedAtRef.current) / 1000 : recorder.currentTime;
      startedAtRef.current = null;
      setRecording(false);
      setDuration(0);
      const uri = String(recorder.uri || '').trim();
      if (!uri) return null;
      let size = 1;
      try { size = Math.max(1, Number(new File(uri).size || 0)); } catch { /* Preserve existing file fallback. */ }
      return { uri, name: voiceFileName(), mimeType: VOICE_MIME_TYPE, size, source: 'voice' as const,
        durationSeconds: normalizeVoiceDurationSeconds(elapsed) };
    })().finally(() => { if (stoppingRef.current === operation) stoppingRef.current = null; });
    stoppingRef.current = operation;
    return operation;
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
