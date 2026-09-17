import { useCallback, useMemo, useState } from 'react';

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
    window.setTimeout(() => setCopiedDiscrepancies(false), 2000);
  }, [discrepanciesText]);

  return { copiedDiscrepancies, discrepanciesText, handleCopyDiscrepancies };
}
