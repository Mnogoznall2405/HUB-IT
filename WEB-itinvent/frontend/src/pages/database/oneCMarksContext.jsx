import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { equipmentOneCMarksAPI } from '../../api/equipmentOneCMarks';

const OneCMarksContext = createContext(null);

export const ONE_C_MARK_ACTION = 'one_c_mark';
export const ONE_C_UNMARK_ACTION = 'one_c_unmark';
// «Не сходится с 1С» требует комментарий, поэтому открывает диалог (его показывает страница).
export const ONE_C_MISMATCH_ACTION = 'one_c_mismatch';

export const isOneCMarkAction = (action) => action === ONE_C_MARK_ACTION || action === ONE_C_UNMARK_ACTION;

export const MARK_KIND_OK = 'ok';
export const MARK_KIND_MISMATCH = 'mismatch';

/** Вердикт проверяющего: '' — отметки нет, иначе 'ok' или 'mismatch' (старые записи без kind = 'ok'). */
export const getOneCMarkKind = (mark) => (mark ? (mark.kind === MARK_KIND_MISMATCH ? MARK_KIND_MISMATCH : MARK_KIND_OK) : '');

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

const toInvKey = (invNoOrItem) => normalizeOneCMarkKey(
  typeof invNoOrItem === 'object' && invNoOrItem
    ? (invNoOrItem.INV_NO || invNoOrItem.inv_no)
    : invNoOrItem,
);

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
    const key = toInvKey(invNoOrItem);
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

  // Отметка «не сходится»: комментарий обязателен. true — сохранено (диалог можно закрыть).
  const saveMismatch = useCallback(async (invNoOrItem, note) => {
    const key = toInvKey(invNoOrItem);
    const text = String(note ?? '').trim();
    if (!canMark || !key || !text || pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    try {
      const mark = await equipmentOneCMarksAPI.set(key, text, MARK_KIND_MISMATCH);
      setMarks((prev) => ({ ...prev, [key]: mark || { inv_no: key, kind: MARK_KIND_MISMATCH, note: text } }));
      notifySuccess?.(`Оборудование ${key} отмечено как не сходящееся с 1С.`);
      return true;
    } catch (error) {
      notifyError?.(errorText(error, 'Не удалось сохранить отметку «не сходится с 1С».'));
      return false;
    } finally {
      pendingRef.current.delete(key);
    }
  }, [canMark, notifyError, notifySuccess]);

  const value = useMemo(() => ({ marks, canMark }), [marks, canMark]);
  return { value, applyAction, saveMismatch };
}
