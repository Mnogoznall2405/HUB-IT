import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import jsonAPI from '../../api/json_client';
import { databaseAPI } from '../../api/database';
import { readFirst, readQty, normalizeDbId, toNumberOrNull } from './databaseRecordModel';
import { isCartridgeLikeConsumable, updateConsumableQtyInGrouped } from './consumableModel';
import { DEFAULT_CARTRIDGE_COLOR } from './equipmentModel';
import { parseDatabaseQrPayload } from './qrModel';
import { readPrinterInvNo, useConsumableQrPrinterPicker } from './useConsumableQrPrinterPicker';

const createClosedModal = () => ({ open: false, item: null, loading: false });

const parseConsumeQty = (value) => {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty <= 0) return null;
  return qty;
};

const buildConsumeSuccessMessage = (item, consumed, qtyNew, printer = null) => {
  const label = String(readFirst(item, ['MODEL_NAME', 'model_name'], '') || '').trim()
    || String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim()
    || 'Расходник';
  const printerLabel = printer
    ? ` → ${String(readFirst(printer, ['MODEL_NAME', 'model_name'], '') || '').trim() || 'МФУ'} (инв. ${readPrinterInvNo(printer)})`
    : '';
  return `Списано ${consumed} шт.: ${label}${printerLabel}. Остаток: ${qtyNew}.`;
};

const buildApiErrorMessage = (error, fallback) => {
  const apiDetail = error?.response?.data?.detail;
  return typeof apiDetail === 'string' && apiDetail.trim() ? apiDetail : fallback;
};

const readPrinterField = (printer, keys) => String(readFirst(printer, keys, '') || '').trim();

// History records need the same required fields as the regular "cartridge
// replacement" action: serial/branch/location of the target unit.
const validatePrinterForHistory = (printer) => {
  if (!readPrinterField(printer, ['SERIAL_NO', 'serial_no'])) {
    return 'У выбранной МФУ не указан серийный номер — запись замены невозможна.';
  }
  if (!readPrinterField(printer, ['BRANCH_NAME', 'branch_name'])) {
    return 'У выбранной МФУ не указан филиал — запись замены невозможна.';
  }
  if (!readPrinterField(printer, ['LOCATION', 'location', 'LOCATION_NAME', 'location_name'])) {
    return 'У выбранной МФУ не указана локация — запись замены невозможна.';
  }
  return null;
};

const buildCartridgeReplacementPayload = ({ consumable, printer, qty, effectiveDbName }) => ({
  printer_model: readPrinterField(printer, ['MODEL_NAME', 'model_name']) || 'Unknown',
  cartridge_color: DEFAULT_CARTRIDGE_COLOR,
  component_type: 'cartridge',
  component_color: DEFAULT_CARTRIDGE_COLOR,
  cartridge_model: readPrinterField(consumable, ['MODEL_NAME', 'model_name']) || undefined,
  detection_source: 'sql-consumables',
  printer_is_color: undefined,
  serial_number: readPrinterField(printer, ['SERIAL_NO', 'serial_no']),
  employee: readPrinterField(printer, ['OWNER_DISPLAY_NAME', 'employee_name']) || 'Не указан',
  branch: readPrinterField(printer, ['BRANCH_NAME', 'branch_name']),
  location: readPrinterField(printer, ['LOCATION', 'location', 'LOCATION_NAME', 'location_name']),
  inv_no: readPrinterInvNo(printer),
  db_name: effectiveDbName,
  equipment_id: toNumberOrNull(readFirst(printer, ['ID', 'id'], null)) ?? undefined,
  current_description: readPrinterField(printer, ['DESCRIPTION', 'description', 'descr']),
  hw_serial_no: readPrinterField(printer, ['HW_SERIAL_NO', 'hw_serial_no']),
  model_name: readPrinterField(printer, ['MODEL_NAME', 'model_name']),
  manufacturer: readPrinterField(printer, ['MANUFACTURER', 'manufacturer', 'VENDOR_NAME', 'vendor_name']),
  additional_data: {
    consumable_item_id: toNumberOrNull(readFirst(consumable, ['ID', 'id'], null)) ?? '',
    consumable_inv_no: String(readFirst(consumable, ['INV_NO', 'inv_no'], '') || '').trim(),
    consumable_model: readPrinterField(consumable, ['MODEL_NAME', 'model_name']),
    consumable_branch: readPrinterField(consumable, ['BRANCH_NAME', 'branch_name']),
    consumable_location: readPrinterField(consumable, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location']),
    consumed_qty: qty,
    source: 'qr_scan',
  },
});

// Card opened by scanning a consumable QR (/database?consumable=<ITEMS.ID>):
// shows stock and lets the user consume units. Also handles the same link
// pasted into the address bar (deep link), including a db_id switch.
export function useConsumableCard({
  canDatabaseWrite = false,
  location = null,
  dbName = '',
  currentDb = null,
  setAllEquipment,
  setFilteredData,
  notifyDatabaseSuccess,
  notifyDatabaseError,
  openEditConsumableQtyModal,
} = {}) {
  const [consumableCardModal, setConsumableCardModal] = useState(createClosedModal);
  const [consumeQtyValue, setConsumeQtyValue] = useState('1');
  const [consumeLoading, setConsumeLoading] = useState(false);
  const [consumeError, setConsumeError] = useState('');
  const printerPicker = useConsumableQrPrinterPicker({
    open: Boolean(consumableCardModal.open),
    item: consumableCardModal.item,
  });

  const openConsumableCard = useCallback((item) => {
    if (!item || typeof item !== 'object') return;
    setConsumeQtyValue('1');
    setConsumeError('');
    setConsumeLoading(false);
    setConsumableCardModal({ open: true, item, loading: false });
  }, []);

  const closeConsumableCard = useCallback(() => {
    setConsumableCardModal(createClosedModal());
    setConsumeQtyValue('1');
    setConsumeError('');
    setConsumeLoading(false);
  }, []);

  const setConsumeQtyInput = useCallback((value) => {
    setConsumeQtyValue(value);
    setConsumeError('');
  }, []);

  const patchConsumableQty = useCallback((item, qtyNew) => {
    const itemId = toNumberOrNull(readFirst(item, ['ID', 'id'], null));
    const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
    const patchLists = (prev) => (
      prev === null || prev === undefined
        ? prev
        : updateConsumableQtyInGrouped(prev, itemId, invNo, qtyNew)
    );
    setAllEquipment?.(patchLists);
    setFilteredData?.(patchLists);
  }, [setAllEquipment, setFilteredData]);

  const handleConsumableConsume = useCallback(async (rawQty) => {
    if (!canDatabaseWrite) {
      setConsumeError('Недостаточно прав для изменения данных.');
      return;
    }
    const item = consumableCardModal.item;
    const qty = parseConsumeQty(rawQty);
    if (qty === null) {
      setConsumeError('Количество должно быть целым числом больше 0.');
      return;
    }
    const itemId = toNumberOrNull(readFirst(item, ['ID', 'id'], null));
    const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
    if (itemId === null && !invNo) {
      setConsumeError('Не удалось определить ID или инвентарный номер расходника.');
      return;
    }

    const selectedPrinter = printerPicker.selectedPrinter;
    if (isCartridgeLikeConsumable(item) && !selectedPrinter) {
      setConsumeError('Выберите МФУ, в которую устанавливается расходник.');
      return;
    }
    const printerError = selectedPrinter ? validatePrinterForHistory(selectedPrinter) : null;
    if (printerError) {
      setConsumeError(printerError);
      return;
    }

    setConsumeLoading(true);
    setConsumeError('');
    try {
      const result = await equipmentAPI.consumeConsumable({
        item_id: itemId ?? undefined,
        inv_no: invNo || undefined,
        qty,
        reason: selectedPrinter ? 'cartridge' : 'qr_scan',
      });
      const qtyNew = toNumberOrNull(result?.qty_new);
      const resolvedQty = qtyNew ?? Math.max(0, readQty(item, 0) - qty);

      setConsumableCardModal((prev) => (
        prev.open && prev.item
          ? { ...prev, item: { ...prev.item, QTY: resolvedQty, qty: resolvedQty } }
          : prev
      ));
      patchConsumableQty(item, resolvedQty);

      if (selectedPrinter) {
        try {
          await jsonAPI.addCartridgeReplacement(buildCartridgeReplacementPayload({
            consumable: item,
            printer: selectedPrinter,
            qty,
            effectiveDbName: normalizeDbId(
              dbName || currentDb?.id || localStorage.getItem('selected_database') || ''
            ),
          }));
        } catch (historyError) {
          setConsumeError(
            `Остаток списан до ${resolvedQty}, но запись в историю не создана: ${buildApiErrorMessage(historyError, 'ошибка записи')}`
          );
          return;
        }
      }
      notifyDatabaseSuccess?.(buildConsumeSuccessMessage(item, qty, resolvedQty, selectedPrinter));
    } catch (error) {
      setConsumeError(buildApiErrorMessage(error, 'Не удалось списать расходник.'));
    } finally {
      setConsumeLoading(false);
    }
  }, [canDatabaseWrite, consumableCardModal.item, currentDb?.id, dbName, notifyDatabaseSuccess, patchConsumableQty, printerPicker.selectedPrinter]);

  const openConsumableQtyEditor = useCallback(() => {
    const item = consumableCardModal.item;
    if (!item) return;
    closeConsumableCard();
    openEditConsumableQtyModal?.(item);
  }, [closeConsumableCard, consumableCardModal.item, openEditConsumableQtyModal]);

  const consumableDeepLinkHandledRef = useRef('');

  useEffect(() => {
    const deepLink = parseDatabaseQrPayload(`${location?.pathname || ''}${location?.search || ''}`);
    if (!deepLink || deepLink.kind !== 'consumable') {
      consumableDeepLinkHandledRef.current = '';
      return;
    }

    const signature = [deepLink.itemId, deepLink.databaseId].join('|');
    if (consumableDeepLinkHandledRef.current === signature) return;

    const currentDatabaseId = normalizeDbId(
      dbName || currentDb?.id || localStorage.getItem('selected_database') || ''
    );
    const targetDatabaseId = normalizeDbId(deepLink.databaseId);
    if (targetDatabaseId && !currentDatabaseId) return;

    consumableDeepLinkHandledRef.current = signature;

    const openLinkedConsumable = async () => {
      try {
        if (targetDatabaseId && targetDatabaseId !== currentDatabaseId) {
          await databaseAPI.switchDatabase(targetDatabaseId);
          localStorage.setItem('selected_database', targetDatabaseId);
          window.dispatchEvent(new CustomEvent('database-changed', {
            detail: { databaseId: targetDatabaseId },
          }));
        }

        setConsumableCardModal({ open: true, item: null, loading: true });
        const item = await equipmentAPI.getConsumableById(deepLink.itemId);
        if (!item) throw new Error('not_found');
        setConsumableCardModal({ open: true, item, loading: false });
      } catch (error) {
        setConsumableCardModal(createClosedModal());
        notifyDatabaseError?.(
          buildApiErrorMessage(error, 'Не удалось открыть карточку расходника по QR-ссылке.')
        );
      }
    };

    void openLinkedConsumable();
  }, [
    currentDb?.id,
    dbName,
    location?.pathname,
    location?.search,
    notifyDatabaseError,
  ]);

  return {
    consumableCardModal,
    consumeQtyValue,
    consumeLoading,
    consumeError,
    consumableQrPrinterPicker: printerPicker,
    openConsumableCard,
    closeConsumableCard,
    setConsumeQtyInput,
    handleConsumableConsume,
    openConsumableQtyEditor,
  };
}

export default useConsumableCard;
