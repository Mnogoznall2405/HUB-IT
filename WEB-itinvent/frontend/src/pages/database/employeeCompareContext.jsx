import { createContext, useContext, useMemo } from 'react';
import { Box, Chip, Tooltip } from '@mui/material';
import { getOneCMark, useOneCMarks } from './oneCMarksContext';
import { isEmployeeCompareSnapshotFresh, resolvePartCompare } from './employeeCompareModel';
import { formatWarehouseQty } from './warehouse1cShared';

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

const RELIABLE_SUMMARY_STATUS = new Set(['match', 'diff', 'only_hub', 'only_1c']);

const chipSx = {
  height: 18,
  flexShrink: 0,
  '& .MuiChip-label': { px: 0.75, fontSize: '0.68rem' },
};

const NO_AUTO_BADGE = { node: null, matched: false };

/**
 * Automatic badge — green «1С ✓» only when the thing is reconciled:
 * with `partNo` → this equipment row's PART_NO matches a 1C balance qty;
 * without `partNo` → the whole owner's list matches and has no unlinked items.
 * Returns NO_AUTO_BADGE when there is nothing to show.
 */
function renderAutoCompareBadge({ summary, partNo = null, manualMark = null }) {
  const counts = summary?.counts || {};
  const summaryStatus = String(summary?.status || '');
  const summaryReliable = isEmployeeCompareSnapshotFresh(summary?.as_of)
    && RELIABLE_SUMMARY_STATUS.has(summaryStatus);

  if (partNo !== null && partNo !== undefined) {
    const compare = resolvePartCompare(summary, partNo);
    if (!compare) return NO_AUTO_BADGE;
    const { matched, hubCount, qty1c } = compare;
    const status = matched ? 'match' : 'diff';
    const title = [
      matched
        ? 'Сверка с 1С (текущая база) — позиция сходится по PART_NO'
        : 'Сверка с 1С (текущая база) — расхождение по PART_NO',
      `Хаб: ${hubCount} · 1С: ${formatWarehouseQty(qty1c)}`,
      summary?.warehouse_name ? `Склад: ${summary.warehouse_name}` : '',
      matched && manualMark ? `Также отмечено вручную: ${formatManualMarkLine(manualMark)}` : '',
    ].filter(Boolean).join('\n');
    return {
      matched,
      node: (
        <Tooltip title={title}>
          <Chip
            size="small"
            color={matched ? 'success' : 'warning'}
            label={matched ? '1С ✓' : '1С ≠'}
            data-compare-status={status}
            sx={chipSx}
          />
        </Tooltip>
      ),
    };
  }

  if (!summaryReliable) return NO_AUTO_BADGE;
  const matched = summaryStatus === 'match' && !counts.no_part;
  if (!matched) return NO_AUTO_BADGE;
  const parts = [`совпадает позиций: ${counts.match || 0}`];
  if (counts.no_part) parts.push(`без парт. №: ${counts.no_part}`);
  if (counts.not_in_1c) parts.push(`«нет в 1С»: ${counts.not_in_1c}`);
  const title = [
    `Сверка с 1С (текущая база) — всё сходится (${parts.join(' · ')})`,
    summary?.warehouse_name ? `Склад: ${summary.warehouse_name}` : '',
  ].filter(Boolean).join('\n');
  return {
    matched: true,
    node: (
      <Tooltip title={title}>
        <Chip
          size="small"
          color="success"
          label="1С ✓"
          data-compare-status="match"
          sx={chipSx}
        />
      </Tooltip>
    ),
  };
}

const formatManualMarkLine = (mark) => {
  const parts = [];
  if (mark?.marked_by) parts.push(mark.marked_by);
  if (mark?.marked_at) {
    const date = new Date(mark.marked_at);
    if (!Number.isNaN(date.getTime())) parts.push(date.toLocaleString('ru-RU'));
  }
  return parts.join(' · ') || 'кем-то из администраторов';
};

function ManualOneCChip({ mark }) {
  const title = [
    'Отмечено вручную: сверено с 1С',
    `Кто и когда: ${formatManualMarkLine(mark)}`,
    mark?.note ? `Примечание: ${mark.note}` : '',
    'Это не результат автоматической сверки; пересчёт её не меняет.',
  ].filter(Boolean).join('\n');
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        variant="outlined"
        color="success"
        label="1С ✎"
        data-compare-status="manual"
        sx={chipSx}
      />
    </Tooltip>
  );
}

/**
 * «1С ✓/≠» — автоматическая сверка по PART_NO. С `invNo` рядом учитывается ручная отметка
 * («1С ✎», контурный чип): при автоматическом «сходится» показывается только он сам, а в
 * подсказке — кто отметил вручную; при «≠» или без авто-статуса ручная отметка видна отдельно.
 */
export function EmployeeCompareBadge({ summary, partNo = null, invNo = null }) {
  const oneC = useOneCMarks();
  const manualMark = invNo !== null && invNo !== undefined && invNo !== '' ? getOneCMark(oneC, invNo) : null;
  const { node: auto, matched } = renderAutoCompareBadge({ summary, partNo, manualMark });
  if (!manualMark || matched) return auto;
  if (!auto) return <ManualOneCChip mark={manualMark} />;
  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
      {auto}
      <ManualOneCChip mark={manualMark} />
    </Box>
  );
}
