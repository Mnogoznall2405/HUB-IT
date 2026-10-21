import { createContext, Fragment, useContext, useMemo } from 'react';
import { Box, Chip, Tooltip } from '@mui/material';
import { getOneCMark, getOneCMarkKind, MARK_KIND_MISMATCH, MARK_KIND_OK, useOneCMarks } from './oneCMarksContext';
import { isPartNoMissingIn1C } from './partNoCheck';
import { isEmployeeCompareSnapshotFresh, resolveNoWarehouse, resolvePartCompare } from './employeeCompareModel';
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
    if (!compare) {
      const gap = resolveNoWarehouse(summary, partNo);
      if (!gap) return NO_AUTO_BADGE;
      return {
        matched: false,
        gap: true,
        node: (
          <Tooltip
            title={gap === 'ambiguous'
              ? 'Сверка с 1С невозможна: найдено слишком много похожих складов, сотрудника не удалось определить.'
              : 'Сверка с 1С невозможна: склад сотрудника в 1С не найден.'}
          >
            <Chip
              size="small"
              variant="outlined"
              label="1С —"
              data-compare-status="no_warehouse"
              sx={{ ...chipSx, color: 'text.secondary' }}
            />
          </Tooltip>
        ),
      };
    }
    const { matched, hubCount, qty1c } = compare;
    const status = matched ? 'match' : 'diff';
    const title = [
      matched
        ? 'Сверка с 1С (текущая база) — позиция сходится по PART_NO'
        : 'Сверка с 1С (текущая база) — расхождение по PART_NO',
      `Хаб: ${hubCount} · 1С: ${formatWarehouseQty(qty1c)}`,
      summary?.warehouse_name
        ? `${Number(summary.warehouse_count) > 1 ? `Склады (остатки суммируются, ${summary.warehouse_count})` : 'Склад'}: ${summary.warehouse_name}`
        : '',
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

function MismatchOneCChip({ mark }) {
  const title = [
    'Отмечено вручную: не сходится с 1С',
    `Кто и когда: ${formatManualMarkLine(mark)}`,
    mark?.note ? `Комментарий: ${mark.note}` : '',
    'Это не результат автоматической сверки; пересчёт её не меняет.',
  ].filter(Boolean).join('\n');
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        color="error"
        label="1С ✕"
        data-compare-status="mismatch"
        sx={chipSx}
      />
    </Tooltip>
  );
}

function NotInNomenclatureChip({ partNo }) {
  return (
    <Tooltip title={`В номенклатуре 1С нет позиции с таким PART_NO («${String(partNo).trim()}»). Проверьте код.`}>
      <Chip
        size="small"
        variant="outlined"
        color="warning"
        label="1С ?"
        data-compare-status="not_in_nomenclature"
        sx={chipSx}
      />
    </Tooltip>
  );
}

/**
 * «1С ✓/≠» — автоматическая сверка по PART_NO. С `invNo` рядом учитывается ручная отметка:
 * «1С ✎» (контурный зелёный) — сверено вручную, при автоматическом «сходится» показывается только
 * авто-чип (в подсказке — кто отметил); «1С ✕» (красный, комментарий в подсказке) — вердикт
 * «не сходится», виден всегда рядом с авто-статусом; «1С ?» (оранжевый) — PART_NO нет в
 * номенклатуре 1С. «Склада в 1С нет» рядом с ручной отметкой или «1С ?» только шумит и скрыт.
 */
export function EmployeeCompareBadge({ summary, partNo = null, invNo = null }) {
  const oneC = useOneCMarks();
  const mark = invNo !== null && invNo !== undefined && invNo !== '' ? getOneCMark(oneC, invNo) : null;
  const kind = getOneCMarkKind(mark);
  const notInNomenclature = partNo !== null && partNo !== undefined && isPartNoMissingIn1C(oneC?.missingPartNos, partNo);
  const { node: auto, matched, gap } = renderAutoCompareBadge({
    summary,
    partNo,
    manualMark: kind === MARK_KIND_OK ? mark : null,
  });

  if (kind === MARK_KIND_OK && matched) return auto;
  const nodes = [];
  if (auto && !(gap && (kind || notInNomenclature))) nodes.push(<Fragment key="auto">{auto}</Fragment>);
  if (kind === MARK_KIND_MISMATCH) nodes.push(<MismatchOneCChip key="mismatch" mark={mark} />);
  if (kind === MARK_KIND_OK) nodes.push(<ManualOneCChip key="manual" mark={mark} />);
  if (notInNomenclature) nodes.push(<NotInNomenclatureChip key="nomenclature" partNo={partNo} />);
  if (!nodes.length) return null;
  if (nodes.length === 1) return nodes[0];
  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
      {nodes}
    </Box>
  );
}
