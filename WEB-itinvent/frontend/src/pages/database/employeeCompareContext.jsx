import { createContext, useContext, useMemo } from 'react';
import { Chip, Tooltip } from '@mui/material';
import { normalizeCompareKey } from './employeeCompareModel';
import { isUsableHubPartNo } from './warehouse1cShared';

const EmployeeCompareContext = createContext(null);

/** Maps the summary API payload list to owner_no → summary entry. */
export function EmployeeCompareProvider({ summaries, children }) {
  const map = useMemo(() => {
    const result = new Map();
    for (const item of Array.isArray(summaries) ? summaries : []) {
      const ownerNo = Number(item?.owner_no);
      if (Number.isInteger(ownerNo) && ownerNo > 0) result.set(ownerNo, item);
    }
    return result;
  }, [summaries]);
  return (
    <EmployeeCompareContext.Provider value={map}>
      {children}
    </EmployeeCompareContext.Provider>
  );
}

export function useEmployeeCompare(ownerNo) {
  const map = useContext(EmployeeCompareContext);
  if (!map) return null;
  return map.get(Number(ownerNo)) || null;
}

/**
 * Compact badge under a name — green «1С ✓» only when the thing is reconciled:
 * with `partNo` → this equipment row's PART_NO matches a 1C balance qty;
 * without `partNo` → the whole owner's list matches and has no unlinked items.
 */
export function EmployeeCompareBadge({ summary, partNo = '' }) {
  const counts = summary?.counts || {};
  const partKey = isUsableHubPartNo(partNo) ? normalizeCompareKey(partNo) : '';
  const partStatus = partKey ? summary?.part_status?.[partKey] : '';
  const matched = partKey
    ? partStatus === 'match'
    : (String(summary?.status || '') === 'match' && !counts.no_part);
  if (!matched) return null;
  const parts = [`совпадает позиций: ${counts.match || 0}`];
  if (counts.no_part) parts.push(`без парт. №: ${counts.no_part}`);
  if (counts.not_in_1c) parts.push(`«нет в 1С»: ${counts.not_in_1c}`);
  const title = [
    partKey
      ? 'Сверка с 1С — эта позиция сходится'
      : `Сверка с 1С — всё сходится (${parts.join(' · ')})`,
    summary?.warehouse_name ? `Склад: ${summary.warehouse_name}` : '',
  ].filter(Boolean).join('\n');
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        color="success"
        label="1С ✓"
        sx={{
          height: 18,
          flexShrink: 0,
          '& .MuiChip-label': { px: 0.75, fontSize: '0.68rem' },
        }}
      />
    </Tooltip>
  );
}
