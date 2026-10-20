import { Fragment, useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { LoadingSpinner } from '../../components/common';
import { compareQtyBreakdown, isBalancesMetaIncomplete, normalizeCompareKey, resolve1cRowStatus, typeNameNeedles } from './employeeCompareModel';
import { filterBalancesByText, formatWarehouseQty, NomenclatureCell, sortBalancesByNomenclature } from './warehouse1cShared';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EmploymentStatusChip from '../../components/EmploymentStatusChip';
import { WH_SORT_GETTERS, sortRowsBy } from './employeeCompareFormat';
import { comparisonRowSx, comparisonScrollSx, comparisonTableSx, comparisonTabsSx, identifierSx, twoLineTextSx } from './employeeComparisonStyles';
import { CompareQtyNote } from './HubEquipmentList';
import WarehouseMovementsList from './WarehouseMovementsList';
import WarehouseCandidateAccordions from './WarehouseCandidateAccordions';

export function WarehouseBalanceMobileRow({ row, warehouse, onOpenBalanceRow, onOpenInWarehouse1C, compareMaps = null }) {
  const clickable = Boolean(onOpenBalanceRow && row?.nomenclature_ref);
  const rowStatus = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
  return (
    <Box
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      data-compare-status={rowStatus || undefined}
      onClick={clickable ? () => onOpenBalanceRow(row, warehouse) : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenBalanceRow(row, warehouse);
        }
      } : undefined}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.9,
        minHeight: 52,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: clickable ? 'pointer' : 'default',
        ...comparisonRowSx(theme, rowStatus),
      })}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box title={[row.nomenclature_code, row.nomenclature_name].filter(Boolean).join(' · ')}
          sx={{ '& .MuiTypography-body2': { ...twoLineTextSx, fontSize: 13 }, '& .MuiTypography-caption': identifierSx }}>
          <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
        </Box>
        {rowStatus === 'diff' ? (
          <CompareQtyNote breakdown={compareQtyBreakdown(row?.nomenclature_code, compareMaps)} />
        ) : null}
      </Box>
      <Chip
        size="small"
        color="primary"
        variant="outlined"
        label={formatWarehouseQty(row.qty_balance)}
        sx={{ flexShrink: 0, minWidth: 56 }}
      />
      {onOpenInWarehouse1C && row?.nomenclature_ref ? (
        <Tooltip title="Открыть в Складе 1С">
          <IconButton
            size="small"
            aria-label="Открыть в Складе 1С"
            onClick={(event) => {
              event.stopPropagation();
              onOpenInWarehouse1C(row, warehouse);
            }}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
}

export function Warehouse1CBalancesPanel({
  visible,
  loading,
  balancesLoading,
  error,
  status,
  warehouse,
  candidates,
  balances,
  balancesMeta = null,
  compareMaps = null,
  filterText = '',
  statusFilter = '',
  allowedCodes = null,
  typeFilterName = '',
  whSortKey = '',
  whSortDir = 'asc',
  onSortWarehouse,
  groupByType = false,
  typeByPartKey = null,
  employmentStatus = '',
  employmentLabel = '',
  isMobile = false,
  activeTab = 'balances',
  onTabChange,
  movements = [],
  movementsLoading = false,
  movementsError = '',
  movementsMeta = null,
  movementsDateFrom = '',
  movementsDateTo = '',
  onMovementsDatesChange,
  onLoadMoreMovements,
  onOpenMovement,
  candidateBalances = {},
  onLoadCandidateBalances,
  onOpenWarehousePage,
  onOpenBalanceRow,
  onOpenInWarehouse1C,
}) {
  const visibleBalances = useMemo(() => {
    let sorted = filterBalancesByText(sortBalancesByNomenclature(balances), filterText);
    if (allowedCodes) {
      const typeNeedles = typeNameNeedles(typeFilterName);
      sorted = sorted.filter((row) => {
        if (allowedCodes.has(normalizeCompareKey(row?.nomenclature_code))) return true;
        const nameKey = normalizeCompareKey(row?.nomenclature_name);
        return typeNeedles.some((needle) => nameKey.includes(needle));
      });
    }
    if (statusFilter) {
      sorted = sorted.filter((row) => {
        const status = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
        return statusFilter === 'none' ? !status : status === statusFilter;
      });
    }
    return sortRowsBy(sorted, WH_SORT_GETTERS, whSortKey, whSortDir);
  }, [balances, filterText, allowedCodes, typeFilterName, statusFilter, compareMaps, whSortKey, whSortDir]);

  const balanceGroups = useMemo(() => {
    if (!groupByType) return [['', visibleBalances]];
    const byType = new Map();
    for (const row of visibleBalances) {
      const type = typeByPartKey?.get(normalizeCompareKey(row?.nomenclature_code))
        || 'Без соответствия в Хабе';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(row);
    }
    return [...byType.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
      .map(([type, groupRows]) => [`${type} · ${groupRows.length}`, groupRows]);
  }, [visibleBalances, groupByType, typeByPartKey]);

  if (!visible) return null;

  const filterActive = Boolean(String(filterText || '').trim())
    || Boolean(statusFilter)
    || Boolean(allowedCodes);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', flex: 1 }}>
      <Box sx={{ minHeight: 36, flexShrink: 0 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          useFlexGap
          flexWrap={isMobile ? 'wrap' : 'nowrap'}
          sx={{ minHeight: 36, pb: isMobile ? 0.5 : 0 }}
        >
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
              Склад 1С
            </Typography>
            <EmploymentStatusChip status={employmentStatus} label={employmentLabel} sx={{ height: 22, fontSize: 11, maxWidth: 170 }} />
          </Stack>
          {status === 'matched' && warehouse?.ref ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={() => onOpenWarehousePage?.(warehouse)}
              title={warehouse.name || undefined}
              sx={{ flexShrink: 0, minHeight: 28, fontSize: 12, py: 0.25, px: 1 }}
            >
              Открыть в Складе 1С
            </Button>
          ) : null}
        </Stack>
      </Box>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ height: 32, flexShrink: 0, minWidth: 0 }}>
      {status === 'matched' ? (
        <Tabs
          value={activeTab}
          onChange={(event, value) => onTabChange?.(value)}
          variant="scrollable"
          scrollButtons={false}
          aria-label="Данные склада 1С"
          sx={{ ...comparisonTabsSx, minHeight: 32, '& .MuiTab-root': { minHeight: 32, fontSize: 12, px: 1.25, py: 0.5 } }}
        >
          <Tab value="balances" label="Остатки" />
          <Tab value="movements" label="Перемещения" />
        </Tabs>
      ) : null}
      {!loading && status === 'matched' && warehouse?.name ? (
        <Typography data-testid="employee-warehouse-name" title={warehouse.name} variant="caption" noWrap sx={{ color: 'text.secondary', ml: 1, minWidth: 0 }}>
          {warehouse.name}
        </Typography>
      ) : null}
      </Stack>

      {activeTab === 'movements' && status === 'matched' ? (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexShrink: 0 }}>
            <TextField
              type="date"
              size="small"
              label="Период с"
              value={movementsDateFrom}
              onChange={(event) => onMovementsDatesChange?.(event.target.value, movementsDateTo)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
            <TextField
              type="date"
              size="small"
              label="по"
              value={movementsDateTo}
              onChange={(event) => onMovementsDatesChange?.(movementsDateFrom, event.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Stack>
          <WarehouseMovementsList
            movements={movements}
            loading={movementsLoading}
            error={movementsError}
            meta={movementsMeta}
            filterText={filterText}
            onLoadMore={onLoadMoreMovements}
            onOpenMovement={onOpenMovement}
          />
        </>
      ) : null}

      {activeTab !== 'movements' || status !== 'matched' ? (
      <>
      {loading ? <LoadingSpinner message="Поиск склада в 1С..." /> : null}
      {status === 'matched' && !balancesLoading && isBalancesMetaIncomplete(balancesMeta) ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Остатки 1С загружены не полностью — совпадения могут быть неполными.
        </Alert>
      ) : null}
      {balancesLoading ? <LoadingSpinner message="Загрузка остатков склада..." /> : null}
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}

      {!loading && !error && status === 'not_found' ? (
        <Alert severity="info">
          Склад 1С для этого сотрудника не найден. Проверьте, что склад в 1С назван по ФИО
          (полностью или с инициалами, например «Рябов А.С.»).
        </Alert>
      ) : null}

      {!loading && !error && status === 'ambiguous' ? (
        <WarehouseCandidateAccordions
          candidates={candidates}
          balancesByRef={candidateBalances}
          filterText={filterText}
          onLoadBalances={onLoadCandidateBalances}
          onOpenWarehousePage={onOpenWarehousePage}
          onOpenBalanceRow={onOpenBalanceRow}
          onOpenInWarehouse1C={onOpenInWarehouse1C}
        />
      ) : null}

      {!loading && !balancesLoading && !error && balances.length > 0 ? (
        isMobile ? (
          <Paper
            variant="outlined"
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
            }}
          >
            {visibleBalances.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                {filterActive ? 'По фильтру в 1С ничего не найдено.' : 'Позиций нет.'}
              </Typography>
            ) : null}
            {balanceGroups.map(([groupName, groupRows]) => (
              <Fragment key={groupName || 'all'}>
                {groupName ? (
                  <Box
                    sx={{
                      px: 1,
                      py: 0.5,
                      bgcolor: 'action.hover',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>{groupName}</Typography>
                  </Box>
                ) : null}
                {groupRows.map((row, index) => (
                  <WarehouseBalanceMobileRow
                    key={`${row.nomenclature_ref || row.nomenclature_name}|${index}`}
                    row={row}
                    warehouse={warehouse}
                    onOpenBalanceRow={onOpenBalanceRow}
                    onOpenInWarehouse1C={onOpenInWarehouse1C}
                    compareMaps={compareMaps}
                  />
                ))}
              </Fragment>
            ))}
          </Paper>
        ) : (
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={comparisonScrollSx}
          >
            <Table size="small" stickyHeader aria-label="Остатки 1С" sx={comparisonTableSx}>
              <colgroup><col style={{ width: 106 }} /><col /><col style={{ width: 76 }} /><col style={{ width: 38 }} /></colgroup>
              <TableHead>
                <TableRow>
                  {[
                    ['code', 'Код'],
                    ['name', 'Номенклатура'],
                  ].map(([key, label]) => (
                    <TableCell key={key} sortDirection={whSortKey === key ? whSortDir : false}>
                      <TableSortLabel
                        active={whSortKey === key}
                        direction={whSortDir}
                        onClick={() => onSortWarehouse?.(key)}
                      >
                        {label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell align="right" sortDirection={whSortKey === 'qty' ? whSortDir : false}>
                    <TableSortLabel
                      active={whSortKey === 'qty'}
                      direction={whSortDir}
                      onClick={() => onSortWarehouse?.('qty')}
                    >
                      Кол-во
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center" />
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleBalances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        {filterActive ? 'По фильтру в 1С ничего не найдено.' : 'Позиций нет.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
                {balanceGroups.map(([groupName, groupRows]) => (
                  <Fragment key={groupName || 'all'}>
                    {groupName ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          sx={{ bgcolor: 'action.hover', py: 0.5, fontWeight: 600 }}
                        >
                          {groupName}
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {groupRows.map((row, index) => {
                  const rowStatus = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
                  return (
                  <TableRow
                    key={`${row.nomenclature_ref || row.nomenclature_name}|${index}`}
                    hover
                    data-compare-status={rowStatus || undefined}
                    onClick={() => onOpenBalanceRow?.(row, warehouse)}
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
                    <TableCell align="right"><Box title={formatWarehouseQty(row.qty_balance)} sx={identifierSx}>{formatWarehouseQty(row.qty_balance)}</Box></TableCell>
                    <TableCell align="center" onClick={(event) => event.stopPropagation()}>
                      {onOpenInWarehouse1C && row?.nomenclature_ref ? (
                        <Tooltip title="Открыть в Складе 1С">
                          <IconButton
                            size="small"
                            aria-label="Открыть в Складе 1С"
                            onClick={() => onOpenInWarehouse1C(row, warehouse)}
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  );
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      ) : null}

      {!loading && !balancesLoading && !error && status === 'matched' && balances.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          На складе нет позиций с ненулевым конечном остатком.
        </Typography>
      ) : null}
      </>
      ) : null}
    </Box>
  );
}

export default Warehouse1CBalancesPanel;
