import { useCallback, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { LoadingSpinner } from '../../components/common';
import { compareQtyBreakdown, isBalancesMetaIncomplete, resolve1cRowStatus } from './employeeCompareModel';
import { comparisonRowSx } from './employeeComparisonStyles';
import { CompareQtyNote } from './HubEquipmentList';
import { filterBalancesByText, formatWarehouseQty, sortBalancesByNomenclature } from './warehouse1cShared';

const identifierSx = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const twoLineTextSx = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
};

// Several 1C warehouses matched the employee: each one is a collapsible block
// whose balances load on the first expand, so nothing navigates away.
function CandidateBalances({ candidate, state, filterText, compareMaps = null, onOpenBalanceRow, onOpenInWarehouse1C }) {
  const rows = useMemo(
    () => filterBalancesByText(sortBalancesByNomenclature(state?.rows || []), filterText),
    [state?.rows, filterText],
  );
  if (!state || state.loading) return <LoadingSpinner message="Загрузка остатков склада..." />;
  if (state.error) return <Alert severity="error">{state.error}</Alert>;
  if (!state.rows.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        На складе нет позиций с ненулевым конечным остатком.
      </Typography>
    );
  }
  return (
    <>
      {isBalancesMetaIncomplete(state.meta) ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Остатки 1С загружены не полностью.
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">По фильтру в 1С ничего не найдено.</Typography>
      ) : (
        <Table size="small" aria-label={`Остатки склада ${candidate.name}`} sx={{ tableLayout: 'fixed' }}>
          <colgroup><col style={{ width: 96 }} /><col /><col style={{ width: 64 }} /><col style={{ width: 38 }} /></colgroup>
          <TableBody>
            {rows.map((row, index) => {
              const rowStatus = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
              return (
              <TableRow
                key={`${row.nomenclature_ref || row.nomenclature_name}|${index}`}
                hover
                data-compare-status={rowStatus || undefined}
                onClick={() => onOpenBalanceRow?.(row, candidate)}
                sx={(theme) => ({
                  cursor: onOpenBalanceRow ? 'pointer' : 'default',
                  ...comparisonRowSx(theme, rowStatus),
                })}
              >
                <TableCell><Box title={row.nomenclature_code || '—'} sx={identifierSx}>{row.nomenclature_code || '—'}</Box></TableCell>
                <TableCell>
                  <Box title={row.nomenclature_name || '—'} sx={twoLineTextSx}>{row.nomenclature_name || '—'}</Box>
                  {rowStatus === 'diff' ? (
                    <CompareQtyNote breakdown={compareQtyBreakdown(row?.nomenclature_code, compareMaps)} />
                  ) : null}
                </TableCell>
                <TableCell align="right">
                  <Box title={formatWarehouseQty(row.qty_balance)} sx={identifierSx}>{formatWarehouseQty(row.qty_balance)}</Box>
                </TableCell>
                <TableCell align="center" onClick={(event) => event.stopPropagation()}>
                  {onOpenInWarehouse1C && row?.nomenclature_ref ? (
                    <Tooltip title="Открыть в Складе 1С">
                      <IconButton
                        size="small"
                        aria-label="Открыть в Складе 1С"
                        onClick={() => onOpenInWarehouse1C(row, candidate)}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export default function WarehouseCandidateAccordions({
  candidates = [],
  balancesByRef = {},
  compareMaps = null,
  filterText = '',
  onLoadBalances,
  onOpenWarehousePage,
  onOpenBalanceRow,
  onOpenInWarehouse1C,
}) {
  const [expanded, setExpanded] = useState(() => new Set());

  const toggle = useCallback((ref, isExpanded) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isExpanded) next.add(ref); else next.delete(ref);
      return next;
    });
    if (isExpanded) onLoadBalances?.(ref);
  }, [onLoadBalances]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {compareMaps
          ? `Найдено складов: ${candidates.length}. Хаб сверен с суммой остатков всех этих складов.`
          : `Найдено складов: ${candidates.length}. Раскройте нужный, чтобы увидеть остатки.`}
      </Typography>
      {candidates.map((candidate) => {
        const isExpanded = expanded.has(candidate.ref);
        const state = balancesByRef[candidate.ref];
        return (
          <Accordion
            key={candidate.ref}
            disableGutters
            variant="outlined"
            expanded={isExpanded}
            onChange={(event, next) => toggle(candidate.ref, next)}
            TransitionProps={{ unmountOnExit: true }}
            sx={{ mb: 0.75, '&:before': { display: 'none' } }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-label={`Склад ${candidate.name}`}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                <Typography variant="body2" noWrap title={candidate.name} sx={{ fontWeight: 600, minWidth: 0 }}>
                  {candidate.name}
                </Typography>
                {state && !state.loading && !state.error ? (
                  <Chip size="small" label={state.rows.length} sx={{ height: 20, fontSize: 11 }} />
                ) : null}
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Button
                size="small"
                startIcon={<OpenInNewIcon />}
                onClick={() => onOpenWarehousePage?.(candidate)}
                sx={{ mb: 0.5 }}
              >
                Открыть в Складе 1С
              </Button>
              <CandidateBalances
                candidate={candidate}
                state={state}
                filterText={filterText}
                compareMaps={compareMaps}
                onOpenBalanceRow={onOpenBalanceRow}
                onOpenInWarehouse1C={onOpenInWarehouse1C}
              />
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}
