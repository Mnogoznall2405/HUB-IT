import { useCallback, useRef, useState } from 'react';

const VOICE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
];

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mimeType of VOICE_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
    } catch {
      // ignore
    }
  }
  return null;
}

function getExtensionForMime(mimeType) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

export default function useVoiceRecorder({ onRecordingComplete, notifyWarning } = {}) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const mimeTypeRef = useRef(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current) {
      try {
        if (recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      recorderRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;
    }
    chunksRef.current = [];
    startTimeRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (recording) return;

    // Проверка secure context (HTTPS или localhost) — getUserMedia требует secure context
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      notifyWarning?.('Запись голоса доступна только по HTTPS. Откройте сайт через https:// или localhost.');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      notifyWarning?.('Браузер не поддерживает запись голоса (mediaDevices API недоступен).');
      return;
    }

    const supportedMimeType = getSupportedMimeType();
    if (!supportedMimeType) {
      notifyWarning?.('Браузер не поддерживает запись голосовых сообщений.');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.error('[VoiceRecorder] getUserMedia error:', err?.name, err?.message, err);
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        notifyWarning?.('Доступ к микрофону запрещён. Нажмите на значок 🔒 в адресной строке и разрешите доступ к микрофону.');
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        notifyWarning?.('Микрофон не найден. Подключите микрофон и попробуйте снова.');
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        notifyWarning?.('Микрофон занят другим приложением. Закройте его и попробуйте снова.');
      } else {
        notifyWarning?.(`Не удалось получить доступ к микрофону: ${err?.message || 'неизвестная ошибка'}`);
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    mimeTypeRef.current = supportedMimeType;

    const recorder = new MediaRecorder(stream, { mimeType: supportedMimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      // handled in stopRecording
    };

    recorder.onerror = () => {
      cleanup();
      setRecording(false);
      setDuration(0);
      notifyWarning?.('Ошибка записи голосового сообщения.');
    };

    recorder.start(250);
    startTimeRef.current = Date.now();
    setRecording(true);
    setDuration(0);

    timerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 200);
  }, [cleanup, notifyWarning, recording]);

  const stopRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') {
      cleanup();
      setRecording(false);
      setDuration(0);
      return;
    }

    const recorder = recorderRef.current;
    const mimeType = mimeTypeRef.current || 'audio/webm';
    const ext = getExtensionForMime(mimeType);

    recorder.onstop = () => {
      const chunks = chunksRef.current;
      if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: mimeType });
        const durationSeconds = startTimeRef.current
          ? Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))
          : 1;
        const file = new File([blob], `voice_${Date.now()}.${ext}`, {
          type: mimeType,
          lastModified: Date.now(),
        });
        onRecordingComplete?.({ file, blob, duration: durationSeconds, mimeType });
      }
      cleanup();
      setRecording(false);
      setDuration(0);
    };

    try {
      recorder.stop();
    } catch {
      cleanup();
      setRecording(false);
      setDuration(0);
    }

    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [cleanup, onRecordingComplete]);

  const cancelRecording = useCallback(() => {
    cleanup();
    setRecording(false);
    setDuration(0);
  }, [cleanup]);

  return {
    voiceRecording: recording,
    voiceRecordingDuration: duration,
    startVoiceRecording: startRecording,
    stopVoiceRecording: stopRecording,
    cancelVoiceRecording: cancelRecording,
  };
}
