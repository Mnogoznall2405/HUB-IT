import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import {
  getQrScannerErrorMessage,
  getQrboxDimensions,
  isIgnorableQrFrameError,
  parseDatabaseQrPayload,
  stopQrScannerInstance,
} from './qrModel';

const QR_READER_ELEMENT_ID = 'qr-reader';
const QR_INVALID_INV_MESSAGE = 'Не удалось распознать инвентарный номер в QR-коде.';
const CAMERA_PROMPT_TIMEOUT_MS = 20000;
const SAME_CODE_DELAY_MS = 1500;

const noop = () => {};

const getCameraPermissionState = async () => {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return '';
    const status = await navigator.permissions.query({ name: 'camera' });
    return String(status?.state || '');
  } catch {
    return '';
  }
};

// An explicit getUserMedia call is what surfaces the "Разрешить камеру" prompt
// inside an installed PWA/WebAPK — Html5Qrcode.start() may reuse a cached denial.
const requestCameraAccess = async () => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(Object.assign(new Error('камера не ответила на запрос разрешения'), {
        name: 'CameraPromptTimeout',
      }));
    }, CAMERA_PROMPT_TIMEOUT_MS);
  });
  try {
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      }),
      timeout,
    ]);
    stream?.getTracks?.().forEach((track) => track.stop());
  } finally {
    clearTimeout(timeoutId);
  }
};

export const buildQrLookupErrorMessage = (error, invNo) => {
  const statusCode = Number(error?.response?.status || 0);
  const apiDetail = error?.response?.data?.detail;

  if (statusCode === 404) {
    return `Оборудование с инв. № "${invNo}" не найдено.`;
  }

  if (typeof apiDetail === 'string' && apiDetail.trim()) {
    return apiDetail;
  }

  return `Не удалось открыть оборудование с инв. № "${invNo}".`;
};

export const buildConsumableLookupErrorMessage = (error, itemId) => {
  const statusCode = Number(error?.response?.status || 0);
  const apiDetail = error?.response?.data?.detail;

  if (statusCode === 404) {
    return `Расходник с ID "${itemId}" не найден.`;
  }

  if (typeof apiDetail === 'string' && apiDetail.trim()) {
    return apiDetail;
  }

  return `Не удалось открыть расходник с ID "${itemId}".`;
};

export const useDatabaseQrScanner = ({
  onEquipmentFound = noop,
  onConsumableFound = noop,
  notifyDatabaseError = noop,
  scannerElementId = QR_READER_ELEMENT_ID,
  autoStart = true,
  // Pairing mode: scanner stays open and emits raw payloads via onPayload —
  // the caller resolves records and decides when the pair is complete.
  continuous = false,
  onPayload = null,
} = {}) => {
  const qrScannerRef = useRef(null);
  const qrScanProcessingRef = useRef(false);
  // Refs keep the latest values readable inside the camera callback without
  // restarting the Html5Qrcode effect on every state change.
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;
  const lastScanRef = useRef({ data: '', at: 0 });
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScannerResult, setQrScannerResult] = useState('');
  const [qrScannerError, setQrScannerError] = useState('');
  const [qrScannerLoading, setQrScannerLoading] = useState(false);
  const [qrScannerReady, setQrScannerReady] = useState(false);
  const [scannerRestartToken, setScannerRestartToken] = useState(0);
  // Фонарик есть не у каждой камеры/браузера: кнопка появляется, только если он поддержан.
  const [qrScannerTorchSupported, setQrScannerTorchSupported] = useState(false);
  const [qrScannerTorchOn, setQrScannerTorchOn] = useState(false);

  const resetScannerState = useCallback(() => {
    qrScanProcessingRef.current = false;
    lastScanRef.current = { data: '', at: 0 };
    setQrScannerResult('');
    setQrScannerError('');
    setQrScannerLoading(false);
    setQrScannerReady(false);
    setQrScannerTorchSupported(false);
    setQrScannerTorchOn(false);
  }, []);

  const openQrScanner = useCallback(() => {
    resetScannerState();
    setQrScannerOpen(true);
  }, [resetScannerState]);

  const closeQrScanner = useCallback(() => {
    resetScannerState();
    setQrScannerOpen(false);
  }, [resetScannerState]);

  const retryQrScanner = useCallback(() => {
    resetScannerState();
    setQrScannerOpen(true);
    setScannerRestartToken((token) => token + 1);
  }, [resetScannerState]);

  const toggleQrScannerTorch = useCallback(async () => {
    try {
      const torch = qrScannerRef.current?.getRunningTrackCameraCapabilities?.()?.torchFeature?.();
      if (!torch?.isSupported?.()) return;
      const next = !torch.value();
      await torch.apply(next);
      setQrScannerTorchOn(next);
    } catch {
      // Камера отказала включить свет — кнопка просто остаётся в прежнем состоянии.
    }
  }, []);

  const handleQrScanSuccess = useCallback(async (decodedText) => {
    if (qrScanProcessingRef.current) return;
    qrScanProcessingRef.current = true;

    const scannedText = String(decodedText || '').trim();
    setQrScannerResult(scannedText);

    const payload = parseDatabaseQrPayload(scannedText);
    if (!payload) {
      qrScanProcessingRef.current = false;
      setQrScannerError(QR_INVALID_INV_MESSAGE);
      return;
    }
    // Короткая вибрация: на телефоне видно, что код считан, даже не глядя на экран.
    try { navigator.vibrate?.(40); } catch { /* вибрация не везде доступна */ }

    if (continuousRef.current) {
      const now = Date.now();
      const last = lastScanRef.current;
      if (last.data === scannedText && now - last.at < SAME_CODE_DELAY_MS) {
        qrScanProcessingRef.current = false;
        return;
      }
      lastScanRef.current = { data: scannedText, at: now };
      setQrScannerResult(scannedText);
      Promise.resolve(onPayloadRef.current?.(payload))
        .catch(() => undefined)
        .finally(() => {
          qrScanProcessingRef.current = false;
        });
      return;
    }

    setQrScannerLoading(true);
    setQrScannerError('');
    try {
      qrScannerRef.current?.pause?.(true);
    } catch {
      // Some browser/camera states do not allow pausing; processing ref still prevents duplicate reads.
    }

    let found;
    try {
      if (payload.kind === 'consumable') {
        found = await equipmentAPI.getConsumableById(payload.itemId);
      } else {
        found = await equipmentAPI.getByInvNo(payload.invNo);
      }
      if (!found) {
        throw new Error('not_found');
      }
    } catch (error) {
      const message = payload.kind === 'consumable'
        ? buildConsumableLookupErrorMessage(error, payload.itemId)
        : buildQrLookupErrorMessage(error, payload.invNo);
      qrScanProcessingRef.current = false;
      setQrScannerLoading(false);
      setQrScannerError(message);
      notifyDatabaseError(message);
      try {
        qrScannerRef.current?.resume?.();
      } catch {
        // Keep the visible error; the user can close and reopen the scanner.
      }
      return;
    }

    setQrScannerOpen(false);
    setQrScannerResult('');
    setQrScannerError('');
    setQrScannerLoading(false);
    setQrScannerReady(false);
    if (payload.kind === 'consumable') {
      onConsumableFound(found);
    } else {
      onEquipmentFound(found, payload.invNo);
    }
  }, [notifyDatabaseError, onConsumableFound, onEquipmentFound]);

  const handleQrScanError = useCallback((errorMessage) => {
    if (!isIgnorableQrFrameError(errorMessage)) {
      console.debug('QR Scanner frame error:', errorMessage);
    }
  }, []);

  useEffect(() => {
    if (!qrScannerOpen || !autoStart) return undefined;

    let isMounted = true;
    let scanner = null;

    const initScanner = async () => {
      try {
        setQrScannerLoading(true);
        setQrScannerReady(false);
        setQrScannerError('');

        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(host);
        if (typeof window !== 'undefined' && window.isSecureContext === false && !isLocalhost) {
          throw new Error('для доступа к камере откройте сайт по HTTPS');
        }
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('браузер не поддерживает доступ к камере');
        }

        // Permission was blocked earlier (PWA keeps the choice): fail fast with
        // actionable text instead of waiting on a prompt that never appears.
        const permissionState = await getCameraPermissionState();
        if (permissionState === 'denied') {
          throw Object.assign(new Error('camera permission denied'), { name: 'NotAllowedError' });
        }
        if (!isMounted) return;

        await new Promise((resolve) => {
          setTimeout(resolve, 350);
        });
        if (!isMounted) return;

        const readerElement = document.getElementById(scannerElementId);
        if (!readerElement) {
          throw new Error(`DOM элемент #${scannerElementId} не найден`);
        }

        // Explicit request is what opens the system "Разрешить камеру" prompt in PWAs.
        await requestCameraAccess();
        if (!isMounted) return;

        const { Html5Qrcode } = await import('html5-qrcode');
        if (!isMounted) return;

        scanner = new Html5Qrcode(scannerElementId);
        qrScannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: getQrboxDimensions,
            disableFlip: false,
          },
          handleQrScanSuccess,
          handleQrScanError
        );

        if (!isMounted) {
          await stopQrScannerInstance(scanner);
          return;
        }

        setQrScannerLoading(false);
        setQrScannerReady(true);
        try {
          setQrScannerTorchSupported(Boolean(scanner.getRunningTrackCameraCapabilities?.()?.torchFeature?.()?.isSupported?.()));
        } catch {
          setQrScannerTorchSupported(false);
        }
      } catch (err) {
        console.error('[QR Scanner] Ошибка:', err);
        if (isMounted) {
          setQrScannerLoading(false);
          setQrScannerReady(false);
          setQrScannerError(getQrScannerErrorMessage(err));
        }
      }
    };

    initScanner();

    return () => {
      isMounted = false;
      const scannerToStop = scanner || qrScannerRef.current;
      qrScannerRef.current = null;
      if (scannerToStop) {
        void stopQrScannerInstance(scannerToStop).finally(() => {
          qrScanProcessingRef.current = false;
        });
      } else {
        qrScanProcessingRef.current = false;
      }
    };
  }, [autoStart, handleQrScanError, handleQrScanSuccess, qrScannerOpen, scannerElementId, scannerRestartToken]);

  return {
    qrScannerOpen,
    qrScannerResult,
    qrScannerError,
    qrScannerLoading,
    qrScannerReady,
    openQrScanner,
    closeQrScanner,
    retryQrScanner,
    qrScannerTorchSupported,
    qrScannerTorchOn,
    toggleQrScannerTorch,
    handleQrScanSuccess,
    handleQrScanError,
  };
};

export default useDatabaseQrScanner;
