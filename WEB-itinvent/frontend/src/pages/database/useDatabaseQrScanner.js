import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import {
  getQrScannerErrorMessage,
  getQrboxDimensions,
  isIgnorableQrFrameError,
  parseInvNoFromQrText,
  stopQrScannerInstance,
} from './qrModel';

const QR_READER_ELEMENT_ID = 'qr-reader';
const QR_INVALID_INV_MESSAGE = 'Не удалось распознать инвентарный номер в QR-коде.';

const noop = () => {};

const buildQrLookupErrorMessage = (error, invNo) => {
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

export const useDatabaseQrScanner = ({
  onEquipmentFound = noop,
  notifyDatabaseError = noop,
  scannerElementId = QR_READER_ELEMENT_ID,
  autoStart = true,
} = {}) => {
  const qrScannerRef = useRef(null);
  const qrScanProcessingRef = useRef(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [qrScannerResult, setQrScannerResult] = useState('');
  const [qrScannerError, setQrScannerError] = useState('');
  const [qrScannerLoading, setQrScannerLoading] = useState(false);
  const [qrScannerReady, setQrScannerReady] = useState(false);

  const resetScannerState = useCallback(() => {
    qrScanProcessingRef.current = false;
    setQrScannerResult('');
    setQrScannerError('');
    setQrScannerLoading(false);
    setQrScannerReady(false);
  }, []);

  const openQrScanner = useCallback(() => {
    resetScannerState();
    setQrScannerOpen(true);
  }, [resetScannerState]);

  const closeQrScanner = useCallback(() => {
    resetScannerState();
    setQrScannerOpen(false);
  }, [resetScannerState]);

  const handleQrScanSuccess = useCallback(async (decodedText) => {
    if (qrScanProcessingRef.current) return;
    qrScanProcessingRef.current = true;

    const scannedText = String(decodedText || '').trim();
    setQrScannerResult(scannedText);

    const invNo = parseInvNoFromQrText(scannedText);
    if (!invNo) {
      qrScanProcessingRef.current = false;
      setQrScannerError(QR_INVALID_INV_MESSAGE);
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
      found = await equipmentAPI.getByInvNo(invNo);
      if (!found) {
        throw new Error('not_found');
      }
    } catch (error) {
      const message = buildQrLookupErrorMessage(error, invNo);
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
    onEquipmentFound(found, invNo);
  }, [notifyDatabaseError, onEquipmentFound]);

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

        await new Promise((resolve) => {
          setTimeout(resolve, 120);
        });
        if (!isMounted) return;

        const readerElement = document.getElementById(scannerElementId);
        if (!readerElement) {
          throw new Error(`DOM элемент #${scannerElementId} не найден`);
        }

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
  }, [autoStart, handleQrScanError, handleQrScanSuccess, qrScannerOpen, scannerElementId]);

  return {
    qrScannerOpen,
    qrScannerResult,
    qrScannerError,
    qrScannerLoading,
    qrScannerReady,
    openQrScanner,
    closeQrScanner,
    handleQrScanSuccess,
    handleQrScanError,
  };
};

export default useDatabaseQrScanner;
