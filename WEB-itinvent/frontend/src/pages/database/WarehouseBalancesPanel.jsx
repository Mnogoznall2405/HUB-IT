import { Fragment, useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
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
import { filterBalancesByText, formatWarehouseQty, NomenclatureCell, sortBalancesByNomenclature, statusRowSx } from './warehouse1cShared';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EmploymentStatusChip from '../../components/EmploymentStatusChip';
import { COLUMN_HEADER_MIN_HEIGHT, WH_SORT_GETTERS, sortRowsBy } from './employeeCompareFormat';
import { CompareQtyNote } from './HubEquipmentList';
import WarehouseMovementsList from './WarehouseMovementsList';

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
        ...statusRowSx(theme, rowStatus),
      })}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
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
  onSelectCandidate,
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
      <Box sx={{ minHeight: COLUMN_HEADER_MIN_HEIGHT, mb: 1, flexShrink: 0 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          useFlexGap
          flexWrap="wrap"
          sx={{ minHeight: 40 }}
        >
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Склад 1С
            </Typography>
            <EmploymentStatusChip status={employmentStatus} label={employmentLabel} />
          </Stack>
          {status === 'matched' && warehouse?.ref ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={() => onOpenWarehousePage?.(warehouse)}
              sx={{ flexShrink: 0 }}
            >
              Открыть в Складе 1С
            </Button>
          ) : null}
        </Stack>
        {!loading && status === 'matched' && warehouse?.name ? (
          <Typography data-testid="employee-warehouse-name" variant="body2" sx={{ fontWeight: 600 }}>
            {warehouse.name}
          </Typography>
        ) : null}
      </Box>

      {status === 'matched' ? (
        <Tabs
          value={activeTab}
          onChange={(event, value) => onTabChange?.(value)}
          variant="scrollable"
          scrollButtons={false}
          sx={{ minHeight: 36, mb: 1, flexShrink: 0 }}
        >
          <Tab value="balances" label="Остатки" sx={{ minHeight: 36, textTransform: 'none', py: 0.5 }} />
          <Tab value="movements" label="Перемещения" sx={{ minHeight: 36, textTransform: 'none', py: 0.5 }} />
        </Tabs>
      ) : null}

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
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Найдено несколько похожих складов — выберите нужный:
          </Typography>
          <List dense disablePadding>
            {candidates.map((candidate) => (
              <ListItemButton
                key={candidate.ref}
                onClick={() => onSelectCandidate(candidate.ref)}
                sx={{ borderRadius: 1, mb: 0.5 }}
              >
                <ListItemText
                  primary={candidate.name}
                  secondary={(
                    <Button
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenWarehousePage?.(candidate);
                      }}
                    >
                      Открыть этот склад в Складе 1С
                    </Button>
                  )}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>
      ) : null}

      {!loading && !balancesLoading && !error && balances.length > 0 ? (
        isMobile ? (
          <Paper
            variant="outlined"
            sx={{
              flex: 1,
              minHeight: 0,
              maxHeight: { xs: '42vh', sm: 'none' },
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
            sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
          >
            <Table size="small" stickyHeader>
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
                  <TableCell align="center" sx={{ width: 48 }} />
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
                      ...statusRowSx(theme, rowStatus),
                    })}
                  >
                    <TableCell>{row.nomenclature_code || '—'}</TableCell>
                    <TableCell>
                      {row.nomenclature_name || '—'}
                      {rowStatus === 'diff' ? (
                        <CompareQtyNote breakdown={compareQtyBreakdown(row?.nomenclature_code, compareMaps)} />
                      ) : null}
                    </TableCell>
                    <TableCell align="right">{formatWarehouseQty(row.qty_balance)}</TableCell>
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
