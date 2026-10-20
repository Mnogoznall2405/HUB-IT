import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { equipmentOneCMarksAPI } from '../../api/equipmentOneCMarks';

const OneCMarksContext = createContext(null);

export const ONE_C_MARK_ACTION = 'one_c_mark';
export const ONE_C_UNMARK_ACTION = 'one_c_unmark';

export const isOneCMarkAction = (action) => action === ONE_C_MARK_ACTION || action === ONE_C_UNMARK_ACTION;

/** «1001», «1001.0» и « 1001 » — одна карточка (как на бэкенде). */
export const normalizeOneCMarkKey = (value) => {
  const text = String(value ?? '').trim();
  return /^-?\d+\.0+$/.test(text) ? text.split('.')[0] : text;
};

export function OneCMarksProvider({ value, children }) {
  return <OneCMarksContext.Provider value={value}>{children}</OneCMarksContext.Provider>;
}

/** { marks, canMark } или null вне провайдера. */
export function useOneCMarks() {
  return useContext(OneCMarksContext);
}

export const getOneCMark = (oneC, invNo) => oneC?.marks?.[normalizeOneCMarkKey(invNo)] || null;

const errorText = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' && detail ? detail : fallback;
};

/**
 * Ручные отметки сверки с 1С текущей базы. Список грузится один раз на базу,
 * после установки/снятия правится локальная карта — без перезагрузки страницы.
 */
export function useEquipmentOneCMarks({ dbKey = '', enabled = true, canMark = false, notifySuccess, notifyError } = {}) {
  const [marks, setMarks] = useState({});
  const pendingRef = useRef(new Set());

  useEffect(() => {
    setMarks({});
    if (!enabled) return undefined;
    let cancelled = false;
    equipmentOneCMarksAPI.list().then(
      (next) => { if (!cancelled) setMarks(next); },
      // Значок вспомогательный: без отметок остаётся автоматическая сверка.
      () => { if (!cancelled) setMarks({}); },
    );
    return () => { cancelled = true; };
  }, [dbKey, enabled]);

  const applyAction = useCallback(async (action, invNoOrItem) => {
    if (!canMark || !isOneCMarkAction(action)) return;
    const key = normalizeOneCMarkKey(
      typeof invNoOrItem === 'object' && invNoOrItem
        ? (invNoOrItem.INV_NO || invNoOrItem.inv_no)
        : invNoOrItem,
    );
    if (!key || pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    try {
      if (action === ONE_C_MARK_ACTION) {
        const mark = await equipmentOneCMarksAPI.set(key);
        setMarks((prev) => ({ ...prev, [key]: mark || { inv_no: key } }));
        notifySuccess?.(`Оборудование ${key} отмечено как сверенное с 1С вручную.`);
      } else {
        await equipmentOneCMarksAPI.clear(key);
        setMarks((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        notifySuccess?.(`Ручная отметка 1С снята с ${key}.`);
      }
    } catch (error) {
      notifyError?.(errorText(error, 'Не удалось изменить ручную отметку сверки с 1С.'));
    } finally {
      pendingRef.current.delete(key);
    }
  }, [canMark, notifyError, notifySuccess]);

  const value = useMemo(() => ({ marks, canMark }), [marks, canMark]);
  return { value, applyAction };
}
