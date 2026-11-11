import { useEffect, useMemo, useRef, useState } from 'react';

import { warehousePartNoCheckAPI } from '../../api/warehousePartNoCheck';
import { isUsableHubPartNo } from './warehouse1cShared';

const CHUNK_SIZE = 500;

/** Ключ сравнения PART_NO: без регистра и лишних пробелов. */
export const normalizePartNoKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const readItemPartNo = (item) => String(item?.PART_NO ?? item?.part_no ?? '').trim();

/** Реальные PART_NO загруженных строк: key → исходный текст (пустые, «-» и «нет в 1С» не проверяем). */
export const collectPartNos = (groupedData) => {
  const result = new Map();
  Object.values(groupedData || {}).forEach((locations) => {
    Object.values(locations || {}).forEach((items) => {
      (items || []).forEach((item) => {
        const text = readItemPartNo(item);
        if (!isUsableHubPartNo(text)) return;
        const key = normalizePartNoKey(text);
        if (key && !result.has(key)) result.set(key, text);
      });
    });
  });
  return result;
};

/** true — PART_NO есть, но в номенклатуре 1С такого кода нет (проверка отработала). */
export const isPartNoMissingIn1C = (missingPartNos, partNo) => {
  if (!missingPartNos || !missingPartNos.size || !isUsableHubPartNo(partNo)) return false;
  return missingPartNos.has(normalizePartNoKey(partNo));
};

/**
 * Проверка PART_NO загруженных строк по локальному снимку номенклатуры 1С порциями.
 * Пока снимок не готов или запрос упал, ничего не помечается (до смены базы повторов нет).
 */
export function useMissingPartNos({ dbKey = '', enabled = true, groupedData }) {
  const [missing, setMissing] = useState(() => new Set());
  const stateRef = useRef({ checked: new Set(), stopped: false });
  const partNos = useMemo(() => (enabled ? collectPartNos(groupedData) : new Map()), [enabled, groupedData]);

  useEffect(() => {
    stateRef.current = { checked: new Set(), stopped: false };
    setMissing(new Set());
  }, [dbKey, enabled]);

  useEffect(() => {
    const state = stateRef.current;
    if (!enabled || state.stopped) return undefined;
    const fresh = [...partNos].filter(([key]) => !state.checked.has(key));
    if (!fresh.length) return undefined;
    let cancelled = false;
    (async () => {
      for (let start = 0; start < fresh.length; start += CHUNK_SIZE) {
        const chunk = fresh.slice(start, start + CHUNK_SIZE);
        let answer;
        try {
          answer = await warehousePartNoCheckAPI.check(chunk.map(([, text]) => text));
        } catch {
          state.stopped = true;
          return;
        }
        if (cancelled) return;
        if (!answer.available) {
          state.stopped = true;
          return;
        }
        chunk.forEach(([key]) => state.checked.add(key));
        const absent = answer.missing.map(normalizePartNoKey).filter(Boolean);
        if (absent.length) setMissing((prev) => new Set([...prev, ...absent]));
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, partNos, dbKey]);

  return missing;
}
