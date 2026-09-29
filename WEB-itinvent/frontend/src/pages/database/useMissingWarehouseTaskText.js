import { useEffect, useMemo, useRef, useState } from 'react';

import { warehouse1cAPI } from '../../api/warehouse1c';
import { readFirst } from './databaseRecordModel';
import { buildMissingWarehouseTaskText } from './employeeCompareFormat';
import { normalizeCompareKey } from './employeeCompareModel';

const makeInventoryItemLink = (item, invNo) => {
  const normalized = String(invNo || '').trim();
  if (!normalized || normalized === '-') return '';
  const dbId = String(readFirst(item, ['hub_db_id', 'HUB_DB_ID'], '') || '').trim();
  const params = new URLSearchParams({ inv_no: normalized });
  if (dbId) params.set('db_id', dbId);
  return `/database?${params.toString()}`;
};

// Подсказки для задачи «склад 1С не найден»: остатки по парт. № на складах
// других сотрудников + прежние владельцы из истории. Текст собирается сразу
// по приходу ответа — диалог показывает черновик, который можно править.
export default function useMissingWarehouseTaskText({
  active,
  employeeName,
  hubItems,
  warehouseCandidates,
}) {
  const [hints, setHints] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seqRef = useRef(0);

  const { codes, invNos } = useMemo(() => {
    const seen = new Set();
    const codeList = [];
    const invList = [];
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const partNo = readFirst(item, ['PART_NO', 'part_no'], '');
      const key = normalizeCompareKey(partNo);
      if (key && !seen.has(key)) {
        seen.add(key);
        codeList.push(String(partNo).trim());
      }
      const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
      if (invNo) invList.push(invNo);
    }
    return { codes: codeList.slice(0, 30), invNos: invList.slice(0, 40) };
  }, [hubItems]);

  useEffect(() => {
    if (!active) {
      setHints(null);
      setLoading(false);
      setError('');
      return undefined;
    }
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    warehouse1cAPI.getMissingWarehouseHints({
      codes,
      invNos,
      employeeName,
      signal: controller.signal,
    })
      .then((payload) => {
        if (seqRef.current !== seq) return;
        setHints(payload || { codes: [], previous_owners: {} });
      })
      .catch((err) => {
        if (seqRef.current !== seq || err?.code === 'ERR_CANCELED') return;
        console.warn('Missing-warehouse hints failed:', err);
        setError(err?.response?.data?.detail || 'Не удалось собрать подсказки по складам.');
        setHints({ codes: [], previous_owners: {} });
      })
      .finally(() => {
        if (seqRef.current === seq) setLoading(false);
      });
    return () => controller.abort();
  }, [active, codes, invNos, employeeName]);

  const taskText = useMemo(
    () => buildMissingWarehouseTaskText({
      employeeName,
      hubItems,
      codeHints: hints?.codes,
      previousOwners: hints?.previous_owners,
      warehouseCandidates,
      makeInvLink: makeInventoryItemLink,
    }),
    [employeeName, hubItems, hints, warehouseCandidates],
  );

  return { taskText, loading, error };
}
