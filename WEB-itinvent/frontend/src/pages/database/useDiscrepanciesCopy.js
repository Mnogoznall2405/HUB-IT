import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildDiscrepanciesText } from './employeeCompareFormat';

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

  const handleCopyDiscrepancies = useCallback(async () => {
    const text = discrepanciesText;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopiedDiscrepancies(true);
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopiedDiscrepancies(false);
    }, 2000);
  }, [discrepanciesText]);

  return { copiedDiscrepancies, discrepanciesText, handleCopyDiscrepancies };
}
