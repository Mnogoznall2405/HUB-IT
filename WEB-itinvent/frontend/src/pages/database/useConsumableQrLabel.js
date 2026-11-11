import { useCallback, useEffect, useMemo, useState } from 'react';

import { readFirst } from './databaseRecordModel';
import {
  buildConsumableQrLabelDataUrl,
  EQUIPMENT_QR_LABEL_HEIGHT_MM,
  EQUIPMENT_QR_LABEL_WIDTH_MM,
} from './equipmentQrLabel';
import { EQUIPMENT_QR_SMALL_LABEL_SIZE } from './equipmentQrPrintFormats';
import { buildConsumableQrLink, buildEquipmentQrDataUrl } from './qrModel';
import { openPrintDialog } from './useEquipmentQrBatchPrint';
import { waitForEquipmentQrPrintImages } from './EquipmentQrPrintPortal';

const createClosedModal = () => ({ open: false, item: null });

// Consumable sticker sheets: 6 columns × 6 rows on A4 by default.
export const CONSUMABLE_QR_PRINT_GRID = { columns: 6, rows: 6 };
const A4_USABLE_WIDTH_MM = 200;
const A4_USABLE_HEIGHT_MM = 287;
const GRID_LIMIT = 10;

const ROLL_LABEL_SIZE = {
  cellWidthMm: EQUIPMENT_QR_LABEL_WIDTH_MM,
  cellHeightMm: EQUIPMENT_QR_LABEL_HEIGHT_MM,
};

// Те же форматы, что у оборудования: рулонные 56 × 50 и 28 × 25 мм либо лист A4.
export const normalizeConsumableQrPrintFormat = (format) => (
  format === 'a4' || format === 'label_small' ? format : 'label'
);

const clampGridValue = (value, fallback) => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, GRID_LIMIT);
};

export const normalizeConsumableQrPrintGrid = (grid = {}) => {
  const columns = clampGridValue(grid.columns, CONSUMABLE_QR_PRINT_GRID.columns);
  const rows = clampGridValue(grid.rows, CONSUMABLE_QR_PRINT_GRID.rows);
  return {
    columns,
    rows,
    cellWidthMm: Math.round((A4_USABLE_WIDTH_MM / columns) * 100) / 100,
    cellHeightMm: Math.round((A4_USABLE_HEIGHT_MM / rows) * 100) / 100,
  };
};

// QR label for one consumable card: link payload + rendered data URL for the
// shared DetailQrDialog. The label encodes ITEMS.ID (?consumable=<id>).
export function useConsumableQrLabel({ databaseId = '' } = {}) {
  const [consumableQrModal, setConsumableQrModal] = useState(createClosedModal);
  const [consumableQrUrl, setConsumableQrUrl] = useState('');
  const [consumableQrUrlLoading, setConsumableQrUrlLoading] = useState(false);
  const [consumableQrPrintLabels, setConsumableQrPrintLabels] = useState([]);
  const [consumableQrPrintGrid, setConsumableQrPrintGrid] = useState(null);
  const [consumableQrPrintLabelSize, setConsumableQrPrintLabelSize] = useState(null);
  const [consumableQrBatchItems, setConsumableQrBatchItems] = useState(null);
  const [consumableQrPrinting, setConsumableQrPrinting] = useState(false);
  const [consumableQrBatchOpen, setConsumableQrBatchOpen] = useState(false);

  const consumableQrText = useMemo(
    () => (consumableQrModal.item ? buildConsumableQrLink(consumableQrModal.item, { databaseId }) : ''),
    [consumableQrModal.item, databaseId]
  );

  const consumableQrFileName = useMemo(() => {
    const invNo = String(readFirst(consumableQrModal.item, ['INV_NO', 'inv_no'], '') || '').trim();
    const itemId = String(readFirst(consumableQrModal.item, ['ID', 'id'], '') || '').trim();
    return `consumable-qr-${invNo || itemId || 'label'}.png`;
  }, [consumableQrModal.item]);

  const openConsumableQr = useCallback((item) => {
    if (!item || typeof item !== 'object') return;
    setConsumableQrModal({ open: true, item });
  }, []);

  const closeConsumableQr = useCallback(() => {
    setConsumableQrModal(createClosedModal());
  }, []);

  // Печать одной этикетки из окна QR: тот же диалог выбора формата, что у пакета.
  const openConsumableQrPrintSingle = useCallback(() => {
    const item = consumableQrModal.item;
    if (!item || consumableQrPrinting) return;
    setConsumableQrBatchItems([item]);
    setConsumableQrBatchOpen(true);
  }, [consumableQrModal.item, consumableQrPrinting]);

  const openConsumableQrPrintBatch = useCallback(() => {
    if (consumableQrPrinting) return;
    setConsumableQrBatchItems(null);
    setConsumableQrBatchOpen(true);
  }, [consumableQrPrinting]);

  const closeConsumableQrPrintBatch = useCallback(() => {
    if (consumableQrPrinting) return;
    setConsumableQrBatchOpen(false);
    setConsumableQrBatchItems(null);
  }, [consumableQrPrinting]);

  const printConsumableQrBatch = useCallback(async (items, options = {}) => {
    const list = (Array.isArray(items) ? items : [])
      .filter((item) => item && typeof item === 'object');
    if (!list.length || consumableQrPrinting) return;
    const format = normalizeConsumableQrPrintFormat(options?.format);
    setConsumableQrPrinting(true);
    try {
      const labels = [];
      for (const item of list) {
        const link = buildConsumableQrLink(item, { databaseId });
        if (!link) continue;
        const qrDataUrl = await buildEquipmentQrDataUrl(link);
        if (!qrDataUrl) continue;
        const dataUrl = await buildConsumableQrLabelDataUrl({ consumable: item, qrDataUrl, format });
        if (!dataUrl) continue;
        const invNo = String(
          readFirst(item, ['INV_NO', 'inv_no'], '')
          || readFirst(item, ['ID', 'id'], '')
          || 'consumable'
        );
        labels.push({ invNo, dataUrl });
      }
      if (!labels.length) {
        setConsumableQrPrinting(false);
        return;
      }
      setConsumableQrPrintGrid(format === 'a4' ? normalizeConsumableQrPrintGrid(options) : null);
      setConsumableQrPrintLabelSize(
        format === 'label_small' ? EQUIPMENT_QR_SMALL_LABEL_SIZE : (format === 'label' ? ROLL_LABEL_SIZE : null)
      );
      setConsumableQrPrintLabels(labels);
      setConsumableQrBatchOpen(false);
      setConsumableQrBatchItems(null);
    } catch (error) {
      console.error('Error preparing consumable QR batch for print:', error);
      setConsumableQrPrinting(false);
    }
  }, [consumableQrPrinting, databaseId]);

  useEffect(() => {
    if (!consumableQrPrintLabels.length) return undefined;
    let cancelled = false;
    let finished = false;
    // Labels stay mounted until the browser finishes printing — clearing them
    // earlier removes the print stylesheet and leaks page chrome onto paper.
    const finish = () => {
      if (finished) return;
      finished = true;
      setConsumableQrPrintLabels([]);
      setConsumableQrPrinting(false);
    };
    const onAfterPrint = () => finish();
    window.addEventListener('afterprint', onAfterPrint);
    const fallbackTimer = window.setTimeout(finish, 60000);
    void (async () => {
      const imagesReady = await waitForEquipmentQrPrintImages();
      if (cancelled || finished) return;
      if (imagesReady) await openPrintDialog();
      if (!cancelled) setConsumableQrPrinting(false);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', onAfterPrint);
      window.clearTimeout(fallbackTimer);
    };
  }, [consumableQrPrintLabels]);

  useEffect(() => {
    let cancelled = false;
    const text = consumableQrModal.open ? String(consumableQrText || '').trim() : '';
    setConsumableQrUrl('');
    if (!text) {
      setConsumableQrUrlLoading(false);
      return undefined;
    }

    setConsumableQrUrlLoading(true);
    buildEquipmentQrDataUrl(text)
      .then((dataUrl) => {
        if (!cancelled) setConsumableQrUrl(dataUrl);
      })
      .catch((error) => {
        console.error('Error generating consumable QR:', error);
        if (!cancelled) setConsumableQrUrl('');
      })
      .finally(() => {
        if (!cancelled) setConsumableQrUrlLoading(false);
      });

    return () => { cancelled = true; };
  }, [consumableQrModal.open, consumableQrText]);

  return {
    consumableQrModal,
    consumableQrUrl,
    consumableQrUrlLoading,
    consumableQrText,
    consumableQrFileName,
    consumableQrPrintLabels,
    consumableQrPrintGrid,
    consumableQrPrintLabelSize,
    consumableQrBatchItems,
    consumableQrPrinting,
    consumableQrBatchOpen,
    openConsumableQr,
    closeConsumableQr,
    openConsumableQrPrintSingle,
    openConsumableQrPrintBatch,
    closeConsumableQrPrintBatch,
    printConsumableQrBatch,
  };
}

export default useConsumableQrLabel;
