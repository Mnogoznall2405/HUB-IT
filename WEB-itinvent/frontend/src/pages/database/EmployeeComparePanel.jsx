import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Link,
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
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { readFirst } from './databaseRecordModel';
import { LoadingSpinner } from '../../components/common';
import EmploymentStatusChip from '../../components/EmploymentStatusChip';
import {
  buildEmployeeCompare,
  EMPLOYEE_COMPARE_STATUS,
  filterCompareItemsByText,
  filterEmployeeCompareRows,
  isBalancesMetaIncomplete,
} from './employeeCompareModel';
import { formatWarehouseQty, NomenclatureCell } from './warehouse1cShared';

const STATUS_META = {
  [EMPLOYEE_COMPARE_STATUS.MATCH]: { label: 'Сходится', color: 'success' },
  [EMPLOYEE_COMPARE_STATUS.DIFF]: { label: 'Кол-во ≠', color: 'warning' },
  [EMPLOYEE_COMPARE_STATUS.ONLY_1C]: { label: 'Только в 1С', color: 'info' },
  [EMPLOYEE_COMPARE_STATUS.ONLY_HUB]: { label: 'Только в Хабе', color: 'error' },
};

function formatDelta(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return '0';
  const text = formatWarehouseQty(Math.abs(num), 0);
  return num > 0 ? `+${text}` : `−${text}`;
}

function CompareStatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status, color: 'default' };
  return <Chip size="small" color={meta.color} variant="outlined" label={meta.label} />;
}

function hubItemKey(item, index) {
  const invNo = readFirst(item, ['INV_NO', 'inv_no'], '');
  const dbId = readFirst(item, ['hub_db_id', 'HUB_DB_ID'], '');
  return `${dbId}|${invNo}|${index}`;
}

function HubItemsDetail({ items, onOpenInvNo }) {
  if (!items.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        В Хабе позиций нет.
      </Typography>
    );
  }
  return (
    <Stack spacing={0.4}>
      {items.map((item, index) => {
        const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
        const dbId = String(readFirst(item, ['hub_db_id', 'HUB_DB_ID'], '') || '').trim();
        const model = readFirst(item, ['MODEL_NAME', 'model_name'], '-');
        const serial = readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], '');
        const canOpen = Boolean(onOpenInvNo && invNo && invNo !== '-');
        return (
          <Stack key={hubItemKey(item, index)} direction="row" spacing={0.75} alignItems="baseline" useFlexGap flexWrap="wrap">
            {canOpen ? (
              <Link
                component="button"
                type="button"
                variant="caption"
                underline="hover"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInvNo(invNo, dbId ? { databaseId: dbId } : {});
                }}
                sx={{ fontWeight: 700 }}
              >
                {invNo}
              </Link>
            ) : (
              <Typography variant="caption" sx={{ fontWeight: 700 }}>{invNo}</Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {model}
              {serial ? ` · ${serial}` : ''}
              {dbId ? ` · ${dbId}` : ''}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

function BalanceDetailsDetail({ details }) {
  if (!details.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        Строк остатков нет.
      </Typography>
    );
  }
  return (
    <Stack spacing={0.4}>
      {details.map((row, index) => {
        const parts = [
          row.series_number || row.series_name,
          row.characteristic_name,
          row.batch_document_name,
        ].filter((part) => String(part || '').trim());
        return (
          <Typography key={index} variant="caption" color="text.secondary">
            {formatWarehouseQty(row.qty_balance)} шт
            {parts.length ? ` · ${parts.join(' · ')}` : ''}
          </Typography>
        );
      })}
    </Stack>
  );
}

function CompareRowDetails({ row, warehouse, onOpenInvNo, onOpenBalanceRow }) {
  const matchRow = row.nomenclatureRef || row.code
    ? {
        nomenclature_ref: row.nomenclatureRef,
        nomenclature_code: row.code,
        nomenclature_name: row.name,
        qty_balance: row.qty1c,
        warehouse_ref: warehouse?.ref || '',
        warehouse_name: warehouse?.name || '',
      }
    : null;

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{ px: 1, py: 1 }}
      divider={<Divider flexItem orientation="vertical" sx={{ display: { xs: 'none', sm: 'block' } }} />}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          В Хабе
        </Typography>
        <HubItemsDetail items={row.hubItems} onOpenInvNo={onOpenInvNo} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          В 1С (строки остатков)
        </Typography>
        <BalanceDetailsDetail details={row.details1c} />
        {matchRow && onOpenBalanceRow ? (
          <Button
            size="small"
            sx={{ mt: 0.5, textTransform: 'none' }}
            onClick={(event) => {
              event.stopPropagation();
              onOpenBalanceRow(matchRow, warehouse);
            }}
          >
            Подобрать позиции в Хабе
          </Button>
        ) : null}
      </Box>
    </Stack>
  );
}

function CompareMobileRow({ row, expanded, onToggle, children }) {
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.9,
          minHeight: 52,
          cursor: 'pointer',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {row.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {row.code || 'без кода'} · 1С: {formatWarehouseQty(row.qty1c, 0)} · Хаб: {row.hubCount}
          </Typography>
        </Box>
        <CompareStatusChip status={row.status} />
        <IconButton size="small" aria-label={expanded ? 'Скрыть детали' : 'Показать детали'}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      {expanded ? children : null}
    </Box>
  );
}

function ItemsSection({ title, items, filterText, onOpenInvNo }) {
  const [open, setOpen] = useState(false);
  const visible = useMemo(
    () => filterCompareItemsByText(items, filterText),
    [items, filterText],
  );
  if (!items.length || (filterText && !visible.length)) return null;
  return (
    <Paper variant="outlined" sx={{ mt: 1 }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
        }}
      >
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>
          {title} ({visible.length}{visible.length !== items.length ? ` из ${items.length}` : ''})
        </Typography>
        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Box>
      {open ? (
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <HubItemsDetail items={visible} onOpenInvNo={onOpenInvNo} />
        </Box>
      ) : null}
    </Paper>
  );
}

export default function EmployeeComparePanel({
  hubItems = [],
  balances = [],
  balancesMeta = null,
  loading = false,
  balancesLoading = false,
  error = '',
  status = '',
  warehouse = null,
  candidates = [],
  filterText = '',
  employmentStatus = '',
  employmentLabel = '',
  isMobile = false,
  hubLoading = false,
  onSelectCandidate,
  onOpenWarehousePage,
  onOpenBalanceRow,
  onOpenInWarehouse1C,
  onOpenInvNo,
}) {
  const [expandedKey, setExpandedKey] = useState('');

  const compare = useMemo(
    () => buildEmployeeCompare({ hubItems, balances }),
    [hubItems, balances],
  );
  const visibleRows = useMemo(
    () => filterEmployeeCompareRows(compare.rows, filterText),
    [compare.rows, filterText],
  );
  const filterActive = Boolean(String(filterText || '').trim());
  const balancesIncomplete = status === 'matched'
    && !balancesLoading
    && isBalancesMetaIncomplete(balancesMeta);
  const hubItemsLoaded = !hubLoading;

  const toggleRow = (key) => {
    setExpandedKey((prev) => (prev === key ? '' : key));
  };

  const toBalanceRow = (row) => ({
    nomenclature_ref: row.nomenclatureRef,
    nomenclature_code: row.code,
    nomenclature_name: row.name,
    qty_balance: row.qty1c,
    warehouse_ref: warehouse?.ref || '',
    warehouse_name: warehouse?.name || '',
  });

  const renderDetails = (row) => (
    <CompareRowDetails
      row={row}
      warehouse={warehouse}
      onOpenInvNo={onOpenInvNo}
      onOpenBalanceRow={onOpenBalanceRow}
    />
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', flex: 1 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        sx={{ minHeight: 40, mb: 1, flexShrink: 0 }}
      >
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Сравнение Хаб ↔ 1С
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

      {status === 'matched' && warehouse?.name ? (
        <Typography data-testid="employee-warehouse-name" variant="body2" sx={{ fontWeight: 600, mb: 1, flexShrink: 0 }}>
          {warehouse.name}
        </Typography>
      ) : null}

      {loading || hubLoading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            {hubLoading ? 'Загрузка оборудования из Хаба...' : 'Поиск склада в 1С...'}
          </Typography>
        </Stack>
      ) : null}
      {balancesLoading ? <LoadingSpinner message="Загрузка остатков склада..." /> : null}
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}

      {!loading && !error && status === 'not_found' ? (
        <Alert severity="info" sx={{ mb: 1 }}>
          Склад 1С для этого сотрудника не найден — сравнить можно только позиции с парт. № в Хабе.
        </Alert>
      ) : null}

      {!loading && !error && status === 'ambiguous' ? (
        <Box sx={{ mb: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Найдено несколько похожих складов — выберите нужный:
          </Typography>
          <List dense disablePadding>
            {candidates.map((candidate) => (
              <ListItemButton
                key={candidate.ref}
                onClick={() => onSelectCandidate?.(candidate.ref)}
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

      {balancesIncomplete ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Остатки 1С загружены не полностью — расхождения могут быть ложными.
        </Alert>
      ) : null}

      {!loading && !balancesLoading && hubItemsLoaded ? (
        <>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1, flexShrink: 0 }}>
            <Chip size="small" color="success" variant="outlined" label={`Сходится: ${compare.summary.match}`} />
            <Chip size="small" color="warning" variant="outlined" label={`Кол-во ≠: ${compare.summary.diff}`} />
            <Chip size="small" color="info" variant="outlined" label={`Только в 1С: ${compare.summary.only1c}`} />
            <Chip size="small" color="error" variant="outlined" label={`Только в Хабе: ${compare.summary.onlyHub}`} />
            {compare.summary.noPartNo ? (
              <Chip size="small" variant="outlined" label={`Без парт. №: ${compare.summary.noPartNo}`} />
            ) : null}
          </Stack>

          {visibleRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {filterActive
                ? 'По фильтру ничего не найдено.'
                : 'Нет позиций для сравнения: в 1С остатков нет, а в Хабе у позиций не заполнен парт. №.'}
            </Typography>
          ) : isMobile ? (
            <Paper
              variant="outlined"
              sx={{ flex: 1, minHeight: 0, maxHeight: { xs: '42vh', sm: 'none' }, overflow: 'auto' }}
            >
              {visibleRows.map((row) => (
                <CompareMobileRow
                  key={row.key}
                  row={row}
                  expanded={expandedKey === row.key}
                  onToggle={() => toggleRow(row.key)}
                >
                  {renderDetails(row)}
                </CompareMobileRow>
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
                    <TableCell>Парт. №</TableCell>
                    <TableCell>Позиция</TableCell>
                    <TableCell align="right">В 1С</TableCell>
                    <TableCell align="right">В Хабе</TableCell>
                    <TableCell align="right">Δ</TableCell>
                    <TableCell>Статус</TableCell>
                    <TableCell align="center" sx={{ width: 96 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visibleRows.map((row) => {
                    const expanded = expandedKey === row.key;
                    return [
                      <TableRow
                        key={`${row.key}-main`}
                        hover
                        onClick={() => toggleRow(row.key)}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell>{row.code || '—'}</TableCell>
                        <TableCell>
                          {row.code ? (
                            <NomenclatureCell code="" name={row.name} />
                          ) : row.name}
                        </TableCell>
                        <TableCell align="right">
                          {row.details1c.length || row.status !== EMPLOYEE_COMPARE_STATUS.ONLY_HUB
                            ? formatWarehouseQty(row.qty1c, 0)
                            : '—'}
                        </TableCell>
                        <TableCell align="right">{row.hubCount || '—'}</TableCell>
                        <TableCell align="right">{formatDelta(row.delta)}</TableCell>
                        <TableCell>
                          <CompareStatusChip status={row.status} />
                        </TableCell>
                        <TableCell align="center" onClick={(event) => event.stopPropagation()}>
                          <Stack direction="row" spacing={0} justifyContent="center">
                            {onOpenInWarehouse1C && row.nomenclatureRef ? (
                              <Tooltip title="Открыть в Складе 1С">
                                <IconButton
                                  size="small"
                                  aria-label="Открыть в Складе 1С"
                                  onClick={() => onOpenInWarehouse1C(toBalanceRow(row), warehouse)}
                                >
                                  <OpenInNewIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : null}
                            <IconButton
                              size="small"
                              aria-label={expanded ? 'Скрыть детали' : 'Показать детали'}
                              aria-expanded={expanded}
                              onClick={() => toggleRow(row.key)}
                            >
                              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                            </IconButton>
                          </Stack>
                        </TableCell>
                      </TableRow>,
                      expanded ? (
                        <TableRow key={`${row.key}-details`}>
                          <TableCell colSpan={7} sx={{ bgcolor: 'action.hover', py: 0 }}>
                            {renderDetails(row)}
                          </TableCell>
                        </TableRow>
                      ) : null,
                    ];
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <ItemsSection
            title="В Хабе без парт. №"
            items={compare.noPartNoItems}
            filterText={filterText}
            onOpenInvNo={onOpenInvNo}
          />
          <ItemsSection
            title="Отмечено «нет в 1С»"
            items={compare.notIn1cItems}
            filterText={filterText}
            onOpenInvNo={onOpenInvNo}
          />
        </>
      ) : null}
    </Box>
  );
}
