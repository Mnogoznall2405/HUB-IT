import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DESKTOP_CAPABILITIES_CHANGED_EVENT,
  DESKTOP_EQUIPMENT_QR_PRINT_CAPABILITY,
  isDesktopCapabilityAvailable,
  requestDesktopEquipmentQrPrint,
  requestDesktopPrintCurrent,
} from '../../lib/desktopBridge';
import { resolveSelectedEquipmentPrintOrder } from './databaseListModel';
import { buildEquipmentQrPrintBatch, formatQrLabelCount } from './equipmentQrPrint';
import { waitForEquipmentQrPrintImages } from './EquipmentQrPrintPortal';
import { EQUIPMENT_QR_A4_GRID, EQUIPMENT_QR_SMALL_LABEL_SIZE } from './equipmentQrPrintFormats';

const formatSkippedSuffix = (skippedInvNos) => {
  if (!skippedInvNos?.length) return '';
  return ` Пропущено: ${skippedInvNos.length} (${skippedInvNos.join(', ')}).`;
};

const openBrowserPrintDialog = () => {
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    return { accepted: false, status: 'failed' };
  }
  try {
    window.print();
    return { accepted: true, status: 'dialog-opened' };
  } catch {
    return { accepted: false, status: 'failed' };
  }
};

export const openPrintDialog = async () => {
  if (isDesktopCapabilityAvailable(DESKTOP_EQUIPMENT_QR_PRINT_CAPABILITY)) {
    const result = await requestDesktopEquipmentQrPrint('dialog');
    if (result.accepted) return result;
  }
  if (requestDesktopPrintCurrent()) {
    return { accepted: true, status: 'dialog-opened' };
  }
  return openBrowserPrintDialog();
};

const executePrintMode = async (mode) => {
  if (mode !== 'quick') return openPrintDialog();

  if (isDesktopCapabilityAvailable(DESKTOP_EQUIPMENT_QR_PRINT_CAPABILITY)) {
    const result = await requestDesktopEquipmentQrPrint('quick');
    if (result.accepted) return result;
  }
  return openPrintDialog();
};

export default function useEquipmentQrBatchPrint({
  groupedEquipment,
  selectedItems,
  tableSort,
  databaseId,
  onClearSelection,
} = {}) {
  const attemptRef = useRef(0);
  const [desktopQuickPrintAvailable, setDesktopQuickPrintAvailable] = useState(
    () => isDesktopCapabilityAvailable(DESKTOP_EQUIPMENT_QR_PRINT_CAPABILITY)
  );
  const [job, setJob] = useState(null);
  const [printPageActive, setPrintPageActive] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [printOptions, setPrintOptions] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateAvailability = () => {
      setDesktopQuickPrintAvailable(
        isDesktopCapabilityAvailable(DESKTOP_EQUIPMENT_QR_PRINT_CAPABILITY)
      );
    };
    window.addEventListener(DESKTOP_CAPABILITIES_CHANGED_EVENT, updateAvailability);
    return () => window.removeEventListener(DESKTOP_CAPABILITIES_CHANGED_EVENT, updateAvailability);
  }, []);

  const queuePreparedJob = useCallback((preparedJob, mode) => {
    attemptRef.current += 1;
    setPrintPageActive(true);
    setJob({ ...preparedJob, mode, attempt: attemptRef.current });
  }, []);

  useEffect(() => {
    if (!job || typeof window === 'undefined') return undefined;
    const finish = () => setPrintPageActive(false);
    window.addEventListener('afterprint', finish);
    return () => window.removeEventListener('afterprint', finish);
  }, [job]);

  const prepareAndPrint = useCallback(async (mode, format = 'label', items = null) => {
    if (printing) return;
    setPrinting(true);
    setFeedback(null);

    try {
      const ordered = items ? { items, skippedInvNos: [] } : resolveSelectedEquipmentPrintOrder(
        groupedEquipment,
        selectedItems,
        tableSort
      );
      const prepared = await buildEquipmentQrPrintBatch({
        items: ordered.items,
        databaseId,
        skippedInvNos: ordered.skippedInvNos,
        compact: format === 'label_small',
      });
      if (prepared.labels.length === 0) {
        setPrinting(false);
        setFeedback({
          severity: 'warning',
          message: `Не удалось подготовить QR-этикетки.${formatSkippedSuffix(prepared.skippedInvNos)}`,
          canRepeat: false,
        });
        return;
      }
      queuePreparedJob({
        ...prepared,
        format: format === 'a4' || format === 'label_small' ? format : 'label',
        singleEquipment: Boolean(items),
      }, mode);
    } catch (error) {
      console.error('Failed to prepare equipment QR print batch:', error);
      setPrinting(false);
      setFeedback({
        severity: 'error',
        message: 'Не удалось подготовить QR-этикетки. Повторите печать.',
        canRepeat: false,
      });
    }
  }, [databaseId, groupedEquipment, printing, queuePreparedJob, selectedItems, tableSort]);

  useEffect(() => {
    if (!job?.attempt || job.labels.length === 0) return undefined;
    let canceled = false;

    const runPrint = async () => {
      const imagesReady = await waitForEquipmentQrPrintImages();
      if (!imagesReady || canceled) {
        if (!canceled) {
          setPrinting(false);
          setPrintPageActive(false);
          setFeedback({
            severity: 'error',
            message: 'Не удалось подготовить страницу печати.',
            canRepeat: true,
          });
        }
        return;
      }

      const result = await executePrintMode(job.mode);
      if (canceled) return;

      setPrinting(false);
      if (!result.accepted) {
        setPrintPageActive(false);
        setFeedback({
          severity: 'error',
          message: 'Не удалось открыть печать. Проверьте принтер и повторите.',
          canRepeat: true,
        });
        return;
      }

      if (result.status === 'succeeded') setPrintPageActive(false);

      if (!job.singleEquipment) onClearSelection?.();
      const labelCount = formatQrLabelCount(job.labels.length);
      const message = result.status === 'succeeded'
        ? `Отправлено на принтер: ${labelCount}.`
        : `Открыто окно печати: ${labelCount}.`;
      setFeedback({
        severity: result.status === 'succeeded' ? 'success' : 'info',
        message: `${message}${formatSkippedSuffix(job.skippedInvNos)}`,
        canRepeat: true,
      });
    };

    void runPrint();
    return () => {
      canceled = true;
    };
  }, [job, onClearSelection]);

  const repeatLastPrint = useCallback(() => {
    if (!job || printing) return;
    setFeedback(null);
    setPrinting(true);
    queuePreparedJob(job, job.mode);
  }, [job, printing, queuePreparedJob]);

  const printQuick = useCallback(
    () => prepareAndPrint('quick'),
    [prepareAndPrint]
  );
  const printWithDialog = useCallback(
    () => prepareAndPrint('dialog'),
    [prepareAndPrint]
  );
  const openPrintOptions = useCallback(() => {
    if (!printing) setPrintOptions({ items: null });
  }, [printing]);
  const openEquipmentPrintOptions = useCallback((equipment) => {
    if (!printing && equipment) setPrintOptions({ items: [equipment] });
  }, [printing]);
  const closePrintOptions = useCallback(() => setPrintOptions(null), []);
  const confirmPrintOptions = useCallback((format) => {
    if (!printOptions || printing) return;
    setPrintOptions(null);
    void prepareAndPrint('dialog', format, printOptions.items);
  }, [prepareAndPrint, printOptions, printing]);
  const dismissFeedback = useCallback(() => setFeedback(null), []);

  return {
    labels: printPageActive ? (job?.labels || []) : [],
    printGrid: job?.format === 'a4' ? EQUIPMENT_QR_A4_GRID : null,
    printLabelSize: job?.format === 'label_small' ? EQUIPMENT_QR_SMALL_LABEL_SIZE : null,
    printDialog: {
      open: Boolean(printOptions),
      count: printOptions?.items?.length ?? (selectedItems?.length || 0),
      onClose: closePrintOptions,
      onPrint: confirmPrintOptions,
    },
    printing,
    feedback,
    desktopQuickPrintAvailable,
    printQuick,
    printWithDialog,
    openPrintOptions,
    openEquipmentPrintOptions,
    repeatLastPrint,
    dismissFeedback,
  };
}
