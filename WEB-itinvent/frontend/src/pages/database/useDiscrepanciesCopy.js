import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildDiscrepanciesText } from './employeeCompareFormat';
import { readFirst } from './databaseRecordModel';
import { copyTextToClipboard } from '../../lib/clipboard';

const makeInventoryItemLink = (item, invNo) => {
  const normalized = String(invNo || '').trim();
  if (!normalized || normalized === '-') return '';
  const dbId = String(readFirst(item, ['hub_db_id', 'HUB_DB_ID'], '') || '').trim();
  const params = new URLSearchParams({ inv_no: normalized });
  if (dbId) params.set('db_id', dbId);
  return `/database?${params.toString()}`;
};

// Clipboard export of the Hub↔1C reconciliation diff as plain text.
export default function useDiscrepanciesCopy({
  employeeName,
  comparisonComplete,
  hubItems,
  warehouseBalances,
  compareMaps,
}) {
  const [copiedDiscrepancies, setCopiedDiscrepancies] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => () => {
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  const discrepanciesText = useMemo(
    () => buildDiscrepanciesText({
      employeeName,
      comparisonComplete,
      hubItems,
      warehouseBalances,
      compareMaps,
    }),
    [employeeName, comparisonComplete, hubItems, warehouseBalances, compareMaps],
  );

  // Тот же текст для задачи на инвентаризацию — инв. № уже кликабельны.
  const discrepanciesTaskText = useMemo(
    () => buildDiscrepanciesText({
      employeeName,
      comparisonComplete,
      hubItems,
      warehouseBalances,
      compareMaps,
      makeInvLink: makeInventoryItemLink,
    }),
    [employeeName, comparisonComplete, hubItems, warehouseBalances, compareMaps],
  );

  const handleCopyDiscrepancies = useCallback(async () => {
    const text = discrepanciesText;
    await copyTextToClipboard(text);
    setCopiedDiscrepancies(true);
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopiedDiscrepancies(false);
    }, 2000);
  }, [discrepanciesText]);

  return { copiedDiscrepancies, discrepanciesText, discrepanciesTaskText, handleCopyDiscrepancies };
}
