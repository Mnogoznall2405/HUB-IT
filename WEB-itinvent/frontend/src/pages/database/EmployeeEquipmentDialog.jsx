import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
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
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DescriptionIcon from '@mui/icons-material/Description';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { equipmentRecordsAPI } from '../../api/equipmentRecords';
import { equipmentSearchAPI } from '../../api/equipmentSearch';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { LoadingSpinner } from '../../components/common';
import DocumentPreviewDialog from '../../components/documentPreview/DocumentPreviewDialog';
import MailAttachmentPreviewDialog from '../../components/mail/MailAttachmentPreviewDialog';
import { MAX_PREVIEW_FILE_BYTES } from '../../components/mail/mailMessageFileActions';
import EmploymentStatusChip from '../../components/EmploymentStatusChip';
import { readFirst } from './databaseRecordModel';
import EmployeeNameLink from './EmployeeNameLink';
import EquipmentCurrentActIndicator from './EquipmentCurrentActIndicator';
import HubNomenclatureMatchDialog from './HubNomenclatureMatchDialog';
import InventoryTaskDialog from './InventoryTaskDialog';
import { exportEmployeeEquipmentWorkbook } from './employeeEquipmentExcel';
import { useEquipmentActFilePreview } from './useEquipmentActFilePreview';
import {
  MovementDetailDialog,
  useMovementDetail,
} from './warehouse1cMovementDetail';
import {
  buildCompareMaps,
  compareQtyBreakdown,
  COMPARE_STATUS_LABEL,
  isBalancesMetaIncomplete,
  normalizeCompareKey,
  resolve1cRowStatus,
  resolveHubRowStatus,
  typeNameNeedles,
} from './employeeCompareModel';
import {
  filterBalancesByText,
  formatWarehouseQty,
  NomenclatureCell,
  resolveWarehouseErrorMessage,
  sortBalancesByNomenclature,
  statusRowSx,
} from './warehouse1cShared';

const COLUMN_HEADER_MIN_HEIGHT = 72;

const HUB_SORT_GETTERS = {
  inv: (item) => readFirst(item, ['INV_NO', 'inv_no'], ''),
  model: (item) => readFirst(item, ['MODEL_NAME', 'model_name'], ''),
  type: (item) => readFirst(item, ['TYPE_NAME', 'type_name'], ''),
  serial: (item) => readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], ''),
  part: (item) => readFirst(item, ['PART_NO', 'part_no'], ''),
};

const WH_SORT_GETTERS = {
  code: (row) => row?.nomenclature_code || '',
  name: (row) => row?.nomenclature_name || '',
  qty: (row) => row?.qty_balance ?? '',
};

function compareSortValues(a, b) {
  const numA = Number(a);
  const numB = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }
  return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

function sortRowsBy(rows, getters, key, dir) {
  const getter = getters[key];
  if (!getter) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => sign * compareSortValues(getter(a), getter(b)));
}

function toggleSortState(prev, key) {
  return { key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' };
}

/** Подпись «Хаб: N · 1С: M» на строках с расхождением количества. */
function CompareQtyNote({ breakdown }) {
  if (!breakdown) return null;
  return (
    <Typography variant="caption" color="warning.main" sx={{ display: 'block', fontWeight: 600 }}>
      Хаб: {breakdown.hubCount} · 1С: {formatWarehouseQty(breakdown.qty1c)}
    </Typography>
  );
}

function filterHubItemsByText(items = [], query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    const haystack = [
      readFirst(item, ['INV_NO', 'inv_no'], ''),
      readFirst(item, ['MODEL_NAME', 'model_name'], ''),
      readFirst(item, ['SERIAL_NO', 'serial_no'], ''),
      readFirst(item, ['HW_SERIAL_NO', 'hw_serial_no'], ''),
      readFirst(item, ['PART_NO', 'part_no'], ''),
      readFirst(item, ['TYPE_NAME', 'type_name'], ''),
      readFirst(item, ['hub_db_name', 'HUB_DB_NAME', 'hub_db_id', 'HUB_DB_ID'], ''),
    ]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return haystack.includes(needle);
  });
}

function hubItemDatabaseMeta(item) {
  const databaseId = String(item?.hub_db_id || item?.HUB_DB_ID || '').trim();
  const dbName = String(item?.hub_db_name || item?.HUB_DB_NAME || databaseId || '').trim();
  const isCurrentDb = Boolean(item?.is_current_db ?? item?.IS_CURRENT_DB);
  return { databaseId, dbName, isCurrentDb };
}

function HubDbChip({ item, show }) {
  if (!show) return null;
  const { dbName, isCurrentDb } = hubItemDatabaseMeta(item);
  if (!dbName) return null;
  return (
    <Chip
      size="small"
      variant="outlined"
      color={isCurrentDb ? 'primary' : 'default'}
      label={dbName}
      sx={{ height: 22, maxWidth: 140 }}
    />
  );
}

function HubEquipmentMobileRow({
  item,
  onOpenInvNo,
  onOpenCurrentAct,
  openingCurrentActDocNo,
  showDbChip = false,
  compareMaps = null,
  onOpenHistory,
}) {
  const [expanded, setExpanded] = useState(false);
  const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
  const model = readFirst(item, ['MODEL_NAME', 'model_name'], '-');
  const type = readFirst(item, ['TYPE_NAME', 'type_name'], '');
  const serial = readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], '-');
  const partNo = readFirst(item, ['PART_NO', 'part_no'], '-');
  const rowStatus = partNo !== '-' ? resolveHubRowStatus(partNo, compareMaps) : null;
  const { databaseId } = hubItemDatabaseMeta(item);
  const openMeta = databaseId ? { databaseId } : {};
  const canOpen = Boolean(onOpenInvNo && invNo && invNo !== '-');
  const hasDetails = Boolean(type) || (serial && serial !== '-') || (partNo && partNo !== '-');

  return (
    <Box
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box
        role={canOpen ? 'button' : undefined}
        tabIndex={canOpen ? 0 : undefined}
        data-compare-status={rowStatus || undefined}
        onClick={canOpen ? () => onOpenInvNo(invNo, openMeta) : undefined}
        onKeyDown={canOpen ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenInvNo(invNo, openMeta);
          }
        } : undefined}
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.9,
          minHeight: 52,
          cursor: canOpen ? 'pointer' : 'default',
          ...statusRowSx(theme, rowStatus),
        })}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
              {invNo}
            </Typography>
            <HubDbChip item={item} show={showDbChip} />
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {model}
          </Typography>
          {rowStatus === 'diff' ? (
            <CompareQtyNote breakdown={compareQtyBreakdown(partNo, compareMaps)} />
          ) : null}
        </Box>
        <EquipmentCurrentActIndicator
          item={item}
          onOpenAct={onOpenCurrentAct}
          openingDocNo={openingCurrentActDocNo}
        />
        {onOpenHistory ? (
          <Tooltip title="История передач">
            <IconButton
              size="small"
              aria-label="История передач"
              onClick={(event) => {
                event.stopPropagation();
                onOpenHistory(item);
              }}
            >
              <HistoryIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        {hasDetails ? (
          <IconButton
            size="small"
            aria-label={expanded ? 'Скрыть детали' : 'Показать детали'}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((prev) => !prev);
            }}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        ) : null}
      </Box>
      {expanded && hasDetails ? (
        <Stack spacing={0.35} sx={{ px: 1, pb: 1 }}>
          {type ? (
            <Typography variant="caption" color="text.secondary">
              Тип: {type}
            </Typography>
          ) : null}
          {serial && serial !== '-' ? (
            <Typography variant="caption" color="text.secondary">
              Серийник: {serial}
            </Typography>
          ) : null}
          {partNo && partNo !== '-' ? (
            <Typography variant="caption" color="text.secondary">
              Парт. №: {partNo}
            </Typography>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}

function HubEquipmentTable({
  items,
  loading,
  error,
  onOpenInvNo,
  onOpenCurrentAct,
  openingCurrentActDocNo = '',
  isMobile = false,
  filterActive = false,
  emptyMessage = '',
  compareMaps = null,
  sortKey = '',
  sortDir = 'asc',
  onSort,
  onOpenHistory,
  groupByType = false,
}) {
  const showDbChip = useMemo(() => {
    const ids = new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => hubItemDatabaseMeta(item).databaseId)
        .filter(Boolean),
    );
    return ids.size > 1 || (Array.isArray(items) ? items : []).some((item) => {
      const meta = hubItemDatabaseMeta(item);
      return Boolean(meta.databaseId) && !meta.isCurrentDb;
    });
  }, [items]);

  const itemGroups = useMemo(() => {
    if (!groupByType) return [['', items]];
    const byType = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim() || 'Без типа';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(item);
    }
    return [...byType.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
      .map(([type, groupItems]) => [`${type} · ${groupItems.length}`, groupItems]);
  }, [items, groupByType]);

  if (loading) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">
          Загрузка оборудования из Хаба...
        </Typography>
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (!items.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyMessage || (filterActive
          ? 'По фильтру в Хабе ничего не найдено.'
          : 'У сотрудника нет закреплённого оборудования в Хабе.')}
      </Typography>
    );
  }

  if (isMobile) {
    return (
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          minHeight: 0,
          maxHeight: { xs: '42vh', sm: 'none' },
          overflow: 'auto',
        }}
      >
        {itemGroups.map(([groupName, groupItems]) => (
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
            {groupItems.map((item, index) => {
              const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
              const { databaseId } = hubItemDatabaseMeta(item);
              return (
                <HubEquipmentMobileRow
                  key={`${databaseId || 'db'}|${invNo}|${index}`}
                  item={item}
                  onOpenInvNo={onOpenInvNo}
                  onOpenCurrentAct={onOpenCurrentAct}
                  openingCurrentActDocNo={openingCurrentActDocNo}
                  showDbChip={showDbChip}
                  compareMaps={compareMaps}
                  onOpenHistory={onOpenHistory}
                />
              );
            })}
          </Fragment>
        ))}
      </Paper>
    );
  }

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {[
              ['inv', 'Инв. №'],
              ['model', 'Модель'],
              ['type', 'Тип'],
              ['serial', 'Серийник'],
              ['part', 'Парт. №'],
            ].map(([key, label]) => (
              <TableCell key={key} sortDirection={sortKey === key ? sortDir : false}>
                <TableSortLabel
                  active={sortKey === key}
                  direction={sortDir}
                  onClick={() => onSort?.(key)}
                >
                  {label}
                </TableSortLabel>
              </TableCell>
            ))}
            <TableCell align="center">Акт</TableCell>
            {showDbChip ? <TableCell>База</TableCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {itemGroups.map(([groupName, groupItems]) => (
            <Fragment key={groupName || 'all'}>
              {groupName ? (
                <TableRow>
                  <TableCell
                    colSpan={6 + (showDbChip ? 1 : 0)}
                    sx={{ bgcolor: 'action.hover', py: 0.5, fontWeight: 600 }}
                  >
                    {groupName}
                  </TableCell>
                </TableRow>
              ) : null}
              {groupItems.map((item, index) => {
            const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
            const partNo = readFirst(item, ['PART_NO', 'part_no'], '');
            const rowStatus = resolveHubRowStatus(partNo, compareMaps);
            const { databaseId } = hubItemDatabaseMeta(item);
            const openMeta = databaseId ? { databaseId } : {};
            const canOpen = Boolean(onOpenInvNo && invNo && invNo !== '-');
            return (
              <TableRow
                key={`${databaseId || 'db'}|${invNo}|${index}`}
                hover
                data-compare-status={rowStatus || undefined}
                onClick={canOpen ? () => onOpenInvNo(invNo, openMeta) : undefined}
                sx={(theme) => ({
                  ...(canOpen ? { cursor: 'pointer' } : {}),
                  ...statusRowSx(theme, rowStatus),
                })}
              >
                <TableCell>
                  {canOpen ? (
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      underline="hover"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenInvNo(invNo, openMeta);
                      }}
                    >
                      {invNo}
                    </Link>
                  ) : invNo}
                </TableCell>
                <TableCell>
                  {readFirst(item, ['MODEL_NAME', 'model_name'], '-')}
                  {rowStatus === 'diff' ? (
                    <CompareQtyNote breakdown={compareQtyBreakdown(partNo, compareMaps)} />
                  ) : null}
                </TableCell>
                <TableCell>{readFirst(item, ['TYPE_NAME', 'type_name'], '-')}</TableCell>
                <TableCell>{readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], '-')}</TableCell>
                <TableCell>{readFirst(item, ['PART_NO', 'part_no'], '-')}</TableCell>
                <TableCell align="center" onClick={(event) => event.stopPropagation()}>
                  <Stack direction="row" spacing={0.25} justifyContent="center" alignItems="center">
                    <EquipmentCurrentActIndicator
                      item={item}
                      onOpenAct={onOpenCurrentAct}
                      openingDocNo={openingCurrentActDocNo}
                    />
                    {onOpenHistory ? (
                      <Tooltip title="История передач">
                        <IconButton
                          size="small"
                          aria-label="История передач"
                          onClick={() => onOpenHistory(item)}
                        >
                          <HistoryIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                </TableCell>
                {showDbChip ? (
                  <TableCell>
                    <HubDbChip item={item} show />
                  </TableCell>
                ) : null}
              </TableRow>
            );
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function WarehouseBalanceMobileRow({ row, warehouse, onOpenBalanceRow, onOpenInWarehouse1C, compareMaps = null }) {
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

const MOVEMENT_DOC_TYPE_LABEL = {
  transfer: 'Перемещение',
  receipt: 'Приходный ордер',
  expense: 'Расходный ордер',
};

const MOVEMENT_DIRECTION_LABEL = {
  in: 'Приход',
  out: 'Расход',
  inout: 'Приход/расход',
};

const MOVEMENT_DIRECTION_COLOR = {
  in: 'success',
  out: 'error',
  inout: 'warning',
};

function formatMovementDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function movementDocTitle(doc) {
  const typeLabel = MOVEMENT_DOC_TYPE_LABEL[doc?.document_type] || '';
  const number = String(doc?.registrar_number || '').trim();
  if (typeLabel && number) return `${typeLabel} №${number}`;
  if (typeLabel) return typeLabel;
  const name = String(doc?.registrar_name || '').trim();
  return name || 'Документ';
}

function movementDocHaystack(doc) {
  const parts = [
    doc?.registrar_name,
    doc?.registrar_number,
    doc?.transfer_from_warehouse_name,
    doc?.transfer_to_warehouse_name,
  ];
  for (const item of doc?.items || []) {
    parts.push(item?.nomenclature_code, item?.nomenclature_name);
  }
  return parts.map((p) => String(p || '').toLowerCase()).join(' ');
}

function filterMovementDocsByText(docs, filterText) {
  const query = String(filterText || '').trim().toLowerCase();
  const list = Array.isArray(docs) ? docs : [];
  if (!query) return list;
  return list.filter((doc) => movementDocHaystack(doc).includes(query));
}

function WarehouseMovementRow({ doc, expanded, onToggle, onOpenDoc }) {
  const fromName = String(doc?.transfer_from_warehouse_name || '').trim();
  const toName = String(doc?.transfer_to_warehouse_name || '').trim();
  const route = fromName || toName ? `${fromName || '—'} → ${toName || '—'}` : '';
  const directionLabel = MOVEMENT_DIRECTION_LABEL[doc?.direction] || '';
  const directionColor = MOVEMENT_DIRECTION_COLOR[doc?.direction] || 'default';
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
            {formatMovementDate(doc?.period || doc?.registrar_date)} · {movementDocTitle(doc)}
          </Typography>
          {route ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {route}
            </Typography>
          ) : null}
        </Box>
        {directionLabel ? (
          <Chip size="small" variant="outlined" color={directionColor} label={directionLabel} />
        ) : null}
        <Chip size="small" variant="outlined" label={`${doc?.positions ?? doc?.items?.length ?? 0} поз.`} />
        {onOpenDoc ? (
          <Tooltip title="Карточка документа (вложения)">
            <IconButton
              size="small"
              aria-label="Карточка документа"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDoc(doc);
              }}
            >
              <DescriptionIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        <IconButton size="small" aria-label={expanded ? 'Скрыть позиции' : 'Показать позиции'}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      {expanded ? (
        <Box sx={{ px: 2, pb: 1 }}>
          {(Array.isArray(doc?.items) ? doc.items : []).map((item, index) => {
            const qty = item?.qty_in || item?.qty_out;
            return (
              <Box
                key={`${item?.nomenclature_ref || item?.nomenclature_name}|${index}`}
                sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}
              >
                <Typography variant="caption" sx={{ minWidth: 0 }}>
                  {item?.nomenclature_code ? `${item.nomenclature_code} ` : ''}
                  {item?.nomenclature_name || '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {formatWarehouseQty(qty)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

function WarehouseMovementsList({
  movements,
  loading,
  error,
  meta,
  filterText = '',
  onLoadMore,
  onOpenMovement,
}) {
  const [expandedKey, setExpandedKey] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const visibleDocs = useMemo(
    () => filterMovementDocsByText(movements, filterText).filter(
      (doc) => !directionFilter || doc?.direction === directionFilter,
    ),
    [movements, filterText, directionFilter],
  );
  const filterActive = Boolean(String(filterText || '').trim()) || Boolean(directionFilter);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Stack direction="row" spacing={0.75} sx={{ mb: 1 }}>
        {[
          ['', 'Все'],
          ['in', 'Приход'],
          ['out', 'Расход'],
        ].map(([key, label]) => (
          <Chip
            key={key || 'all'}
            size="small"
            label={label}
            color={key ? (MOVEMENT_DIRECTION_COLOR[key] || 'default') : 'default'}
            variant={directionFilter === key ? 'filled' : 'outlined'}
            onClick={() => setDirectionFilter(key)}
          />
        ))}
      </Stack>
      {loading && visibleDocs.length === 0 ? (
        <LoadingSpinner message="Загрузка перемещений склада..." />
      ) : null}
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
      {!loading && !error && visibleDocs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {filterActive ? 'По фильтру перемещений не найдено.' : 'Перемещений по этому складу нет.'}
        </Typography>
      ) : null}
      {visibleDocs.map((doc, index) => {
        const key = doc?.registrar_ref || `doc-${index}`;
        return (
          <WarehouseMovementRow
            key={key}
            doc={doc}
            expanded={expandedKey === key}
            onToggle={() => setExpandedKey(expandedKey === key ? '' : key)}
            onOpenDoc={onOpenMovement}
          />
        );
      })}
      {meta?.has_more ? (
        <Box sx={{ py: 1 }}>
          <Button
            size="small"
            variant="outlined"
            disabled={loading}
            onClick={() => onLoadMore?.(meta?.next_cursor || '')}
          >
            {loading ? 'Загрузка...' : 'Загрузить ещё'}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

const HISTORY_FIELD_LABELS = [
  ['old_employee_name', 'new_employee_name', 'Сотрудник'],
  ['old_branch_name', 'new_branch_name', 'Филиал'],
  ['old_location_name', 'new_location_name', 'Кабинет'],
  ['old_status_name', 'new_status_name', 'Статус'],
  ['old_type_name', 'new_type_name', 'Тип'],
  ['old_model_name', 'new_model_name', 'Модель'],
  ['old_serial_no', 'new_serial_no', 'Серийник'],
  ['old_inv_no', 'new_inv_no', 'Инв. №'],
];

function EquipmentHistoryDialog({ open, invNo, rows, loading, error, onClose, fullScreen = false }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle sx={{ pr: 6 }}>
        История передач — {invNo}
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Загрузка истории...</Typography>
          </Stack>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!loading && !error && !(Array.isArray(rows) && rows.length) ? (
          <Typography variant="body2" color="text.secondary">
            Записей истории по этой позиции нет.
          </Typography>
        ) : null}
        {!loading && !error && Array.isArray(rows) && rows.length ? (
          <List dense disablePadding>
            {rows.map((row, index) => {
              const changes = HISTORY_FIELD_LABELS
                .filter(([oldKey, newKey]) => String(row?.[oldKey] || '') !== String(row?.[newKey] || ''))
                .map(([oldKey, newKey, label]) => `${label}: ${row?.[oldKey] || '—'} → ${row?.[newKey] || '—'}`);
              return (
                <Box
                  key={row?.hist_id ?? index}
                  sx={{ py: 0.9, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {formatMovementDate(row?.ch_date) || '—'}
                    {row?.ch_user ? ` · ${row.ch_user}` : ''}
                  </Typography>
                  {changes.length ? changes.map((line) => (
                    <Typography key={line} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {line}
                    </Typography>
                  )) : (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Изменение без различий в ключевых полях
                    </Typography>
                  )}
                  {row?.ch_comment ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {row.ch_comment}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </List>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

function Warehouse1CBalancesPanel({
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

export default function EmployeeEquipmentDialog({
  open,
  ownerNo,
  employeeName,
  warehouseRef = '',
  canViewWarehouse1C = false,
  allowCrossDatabase = false,
  stackAboveParent = false,
  disableEnforceFocus = false,
  onClose,
  onOpenInvNo = null,
  buildWarehouseReturnContext = null,
}) {
  const navigate = useNavigate();
  const theme = useTheme();
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: false });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: false });
  const isMobile = isNarrowMobile || isTouchMobile;
  const {
    preview: currentActPreview,
    openingDocNo: openingCurrentActDocNo,
    openActFile: openCurrentAct,
    closePreview: closeCurrentActPreview,
  } = useEquipmentActFilePreview();

  const [hubItems, setHubItems] = useState([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');

  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseBalancesLoading, setWarehouseBalancesLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState('');
  const [warehouseStatus, setWarehouseStatus] = useState('');
  const [warehouseInfo, setWarehouseInfo] = useState(null);
  const [warehouseCandidates, setWarehouseCandidates] = useState([]);
  const [warehouseBalances, setWarehouseBalances] = useState([]);
  const [warehouseBalancesMeta, setWarehouseBalancesMeta] = useState(null);
  const [warehouseTab, setWarehouseTab] = useState('balances');
  const [warehouseMovements, setWarehouseMovements] = useState([]);
  const [warehouseMovementsMeta, setWarehouseMovementsMeta] = useState(null);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsError, setMovementsError] = useState('');
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [movementsDateFrom, setMovementsDateFrom] = useState('');
  const [movementsDateTo, setMovementsDateTo] = useState('');
  const [warehouseLoaded, setWarehouseLoaded] = useState(false);
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [employmentLabel, setEmploymentLabel] = useState('');
  const [hubMatchOpen, setHubMatchOpen] = useState(false);
  const [hubMatchRow, setHubMatchRow] = useState(null);
  const [hubMatchWarehouse, setHubMatchWarehouse] = useState(null);
  const [sharedFilter, setSharedFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [noActFilter, setNoActFilter] = useState(false);
  const [groupByType, setGroupByType] = useState(false);
  const [hubSort, setHubSort] = useState({ key: '', dir: 'asc' });
  const [warehouseSort, setWarehouseSort] = useState({ key: '', dir: 'asc' });
  const [copiedDiscrepancies, setCopiedDiscrepancies] = useState(false);
  const [historyState, setHistoryState] = useState({
    open: false,
    invNo: '',
    loading: false,
    error: '',
    rows: [],
  });
  const movementDetail = useMovementDetail();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const filterActive = Boolean(String(sharedFilter || '').trim())
    || Boolean(typeFilter)
    || noActFilter
    || (Boolean(statusFilter) && canViewWarehouse1C);
  const comparisonComplete = Boolean(
    canViewWarehouse1C
    && warehouseLoaded
    && warehouseStatus === 'matched'
    && !warehouseBalancesLoading
    && !isBalancesMetaIncomplete(warehouseBalancesMeta)
  );
  const compareMaps = useMemo(
    () => (comparisonComplete ? buildCompareMaps({ hubItems, balances: warehouseBalances }) : null),
    [comparisonComplete, hubItems, warehouseBalances],
  );
  const statusFilterActive = Boolean(statusFilter) && comparisonComplete;
  const equipmentTypes = useMemo(() => {
    const seen = new Map();
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim();
      if (type) seen.set(type.toLowerCase(), type);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [hubItems]);
  // Тип — атрибут Хаба: на стороне 1С оставляем только позиции, чей код
  // встречается среди парт. № отфильтрованного по типу оборудования.
  const allowed1cCodes = useMemo(() => {
    if (!typeFilter) return null;
    const codes = new Set();
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim();
      if (type !== typeFilter) continue;
      const key = normalizeCompareKey(readFirst(item, ['PART_NO', 'part_no'], ''));
      if (key) codes.add(key);
    }
    return codes;
  }, [hubItems, typeFilter]);
  const noActCount = useMemo(
    () => (Array.isArray(hubItems) ? hubItems : []).filter(
      (item) => !readFirst(item, ['current_act_available', 'CURRENT_ACT_AVAILABLE'], false),
    ).length,
    [hubItems],
  );
  const typeByPartKey = useMemo(() => {
    const map = new Map();
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const key = normalizeCompareKey(readFirst(item, ['PART_NO', 'part_no'], ''));
      const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim();
      if (key && type && !map.has(key)) map.set(key, type);
    }
    return map;
  }, [hubItems]);
  const visibleHubItems = useMemo(() => {
    let items = filterHubItemsByText(hubItems, sharedFilter);
    if (typeFilter) {
      items = items.filter(
        (item) => String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim() === typeFilter,
      );
    }
    if (noActFilter) {
      items = items.filter(
        (item) => !readFirst(item, ['current_act_available', 'CURRENT_ACT_AVAILABLE'], false),
      );
    }
    if (statusFilterActive) {
      items = items.filter((item) => {
        const status = resolveHubRowStatus(readFirst(item, ['PART_NO', 'part_no'], ''), compareMaps);
        return statusFilter === 'none' ? !status : status === statusFilter;
      });
    }
    return sortRowsBy(items, HUB_SORT_GETTERS, hubSort.key, hubSort.dir);
  }, [hubItems, sharedFilter, typeFilter, noActFilter, statusFilter, statusFilterActive, compareMaps, hubSort]);
  const statusCounts = useMemo(() => {
    if (!canViewWarehouse1C || !compareMaps) return null;
    const counts = { match: 0, diff: 0, only_hub: 0, only_1c: 0, none: 0 };
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const status = resolveHubRowStatus(readFirst(item, ['PART_NO', 'part_no'], ''), compareMaps);
      counts[status || 'none'] += 1;
    }
    for (const row of Array.isArray(warehouseBalances) ? warehouseBalances : []) {
      const status = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
      counts[status || 'none'] += 1;
    }
    return counts;
  }, [canViewWarehouse1C, hubItems, warehouseBalances, compareMaps]);
  const visibleWarehouseBalances = useMemo(() => {
    let rows = filterBalancesByText(sortBalancesByNomenclature(warehouseBalances), sharedFilter);
    if (allowed1cCodes) {
      rows = rows.filter((row) => allowed1cCodes.has(normalizeCompareKey(row?.nomenclature_code)));
    }
    if (statusFilterActive) {
      rows = rows.filter((row) => {
        const status = resolve1cRowStatus(row?.nomenclature_code, compareMaps);
        return statusFilter === 'none' ? !status : status === statusFilter;
      });
    }
    return sortRowsBy(rows, WH_SORT_GETTERS, warehouseSort.key, warehouseSort.dir);
  }, [warehouseBalances, sharedFilter, allowed1cCodes, statusFilter, statusFilterActive, compareMaps, warehouseSort]);
  const exportDisabled = exporting
    || hubLoading
    || (canViewWarehouse1C && (warehouseLoading || warehouseBalancesLoading));

  const resetWarehouseState = useCallback(() => {
    setWarehouseLoading(false);
    setWarehouseBalancesLoading(false);
    setWarehouseError('');
    setWarehouseStatus('');
    setWarehouseInfo(null);
    setWarehouseCandidates([]);
    setWarehouseBalances([]);
    setWarehouseBalancesMeta(null);
    setWarehouseTab('balances');
    setWarehouseMovements([]);
    setWarehouseMovementsMeta(null);
    setMovementsLoading(false);
    setMovementsError('');
    setMovementsLoaded(false);
    setMovementsDateFrom('');
    setMovementsDateTo('');
    setWarehouseLoaded(false);
    setEmploymentStatus('');
    setEmploymentLabel('');
  }, []);

  useEffect(() => {
    const canLoadHub = Boolean(ownerNo);
    const canLoadWarehouse = Boolean(canViewWarehouse1C && (employeeName || warehouseRef));
    if (!open || (!canLoadHub && !canLoadWarehouse)) {
      setHubItems([]);
      setHubError('');
      setHubLoading(false);
      setSharedFilter('');
      setStatusFilter('');
      setTypeFilter('');
      setNoActFilter(false);
      resetWarehouseState();
      return undefined;
    }

    let cancelled = false;
    setHubLoading(canLoadHub);
    setHubError('');
    if (!canLoadHub) setHubItems([]);
    setSharedFilter('');
    setStatusFilter('');
    setTypeFilter('');
    setNoActFilter(false);
    resetWarehouseState();

    const hubPromise = canLoadHub
      ? equipmentSearchAPI.getEmployeeEquipment(ownerNo, {
          employeeName,
          allDatabases: allowCrossDatabase,
        })
          .then((data) => {
            if (cancelled) return;
            const items = Array.isArray(data)
              ? data
              : (Array.isArray(data?.equipment) ? data.equipment : []);
            setHubItems(items);
          })
          .catch((err) => {
            if (cancelled) return;
            console.error('Failed to load employee equipment:', err);
            setHubError('Не удалось загрузить оборудование сотрудника из Хаба.');
            setHubItems([]);
          })
          .finally(() => {
            if (!cancelled) setHubLoading(false);
          })
      : Promise.resolve();

    let warehousePromise = Promise.resolve();
    if (canLoadWarehouse) {
      setWarehouseLoading(true);
      warehousePromise = warehouse1cAPI.getEmployeeWarehouse({
        employeeName,
        warehouseRef,
        loadBalances: false,
      })
        .then((data) => {
          if (cancelled) return;
          setWarehouseStatus(data?.status || '');
          setWarehouseInfo(data?.warehouse || null);
          setWarehouseCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
          setWarehouseBalances(Array.isArray(data?.balances) ? data.balances : []);
          setWarehouseBalancesMeta(data?.balances_meta || null);
          setEmploymentStatus(data?.employment_status || '');
          setEmploymentLabel(data?.employment_label || '');
          setWarehouseLoaded(true);
          setWarehouseLoading(false);

          const matchedWarehouseRef = data?.status === 'matched' ? data?.warehouse?.ref : '';
          if (!matchedWarehouseRef) return;
          setWarehouseBalancesLoading(true);
          return warehouse1cAPI.getEmployeeWarehouse({
            employeeName,
            warehouseRef: matchedWarehouseRef,
            loadBalances: true,
          })
            .then((balancesData) => {
              if (cancelled) return;
              setWarehouseBalances(Array.isArray(balancesData?.balances) ? balancesData.balances : []);
              setWarehouseBalancesMeta(balancesData?.balances_meta || null);
              if (balancesData?.employment_status || balancesData?.employment_label) {
                setEmploymentStatus(balancesData.employment_status || '');
                setEmploymentLabel(balancesData.employment_label || '');
              }
            })
            .catch((err) => {
              if (cancelled) return;
              console.error('Failed to load employee warehouse balances from 1C:', err);
              setWarehouseError(resolveWarehouseErrorMessage(
                err,
                'Склад найден, но не удалось получить его остатки из 1С.',
              ));
            })
            .finally(() => {
              if (!cancelled) setWarehouseBalancesLoading(false);
            });
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('Failed to load employee warehouse from 1C:', err);
          setWarehouseError(resolveWarehouseErrorMessage(err, 'Не удалось получить данные склада из 1С.'));
          setWarehouseStatus('');
          setWarehouseInfo(null);
          setWarehouseCandidates([]);
          setWarehouseBalances([]);
          setWarehouseBalancesMeta(null);
          setEmploymentStatus('');
          setEmploymentLabel('');
          setWarehouseLoaded(true);
        })
        .finally(() => {
          if (!cancelled) setWarehouseLoading(false);
        });
    }

    void hubPromise;
    void warehousePromise;

    return () => {
      cancelled = true;
    };
  }, [open, ownerNo, employeeName, warehouseRef, canViewWarehouse1C, allowCrossDatabase, resetWarehouseState]);

  const loadWarehouseData = useCallback(async (nextWarehouseRef = '') => {
    if (!canViewWarehouse1C || (!employeeName && !nextWarehouseRef)) return;

    setWarehouseLoading(true);
    setWarehouseBalancesLoading(true);
    setWarehouseError('');
    try {
      const data = await warehouse1cAPI.getEmployeeWarehouse({
        employeeName,
        warehouseRef: nextWarehouseRef,
        loadBalances: true,
      });
      setWarehouseStatus(data?.status || '');
      setWarehouseInfo(data?.warehouse || null);
      setWarehouseCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
      setWarehouseBalances(Array.isArray(data?.balances) ? data.balances : []);
      setWarehouseBalancesMeta(data?.balances_meta || null);
      if (data?.employment_status || data?.employment_label) {
        setEmploymentStatus(data.employment_status || '');
        setEmploymentLabel(data.employment_label || '');
      }
      setWarehouseLoaded(true);
    } catch (err) {
      console.error('Failed to load employee warehouse from 1C:', err);
      setWarehouseError(resolveWarehouseErrorMessage(err, 'Не удалось получить данные склада из 1С.'));
      setWarehouseStatus('');
      setWarehouseInfo(null);
      setWarehouseCandidates([]);
      setWarehouseBalances([]);
      setWarehouseBalancesMeta(null);
      setWarehouseLoaded(true);
    } finally {
      setWarehouseLoading(false);
      setWarehouseBalancesLoading(false);
    }
  }, [canViewWarehouse1C, employeeName]);

  const loadWarehouseMovements = useCallback(async (cursor = '', dateFrom, dateTo) => {
    const ref = warehouseInfo?.ref;
    if (!canViewWarehouse1C || !ref) return;

    setMovementsLoading(true);
    setMovementsError('');
    try {
      const data = await warehouse1cAPI.getWarehouseMovements({
        warehouseRef: ref,
        limit: 100,
        cursor,
        dateFrom: dateFrom ?? movementsDateFrom,
        dateTo: dateTo ?? movementsDateTo,
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      setWarehouseMovements((prev) => (cursor ? [...prev, ...items] : items));
      setWarehouseMovementsMeta(data || null);
      setMovementsLoaded(true);
    } catch (err) {
      console.error('Failed to load warehouse movements from 1C:', err);
      setMovementsError(resolveWarehouseErrorMessage(err, 'Не удалось загрузить перемещения склада из 1С.'));
      setMovementsLoaded(true);
    } finally {
      setMovementsLoading(false);
    }
  }, [canViewWarehouse1C, warehouseInfo?.ref, movementsDateFrom, movementsDateTo]);

  const handleLoadMoreMovements = useCallback((cursor) => {
    void loadWarehouseMovements(cursor || '');
  }, [loadWarehouseMovements]);

  const handleMovementsDatesChange = useCallback((from, to) => {
    setMovementsDateFrom(from);
    setMovementsDateTo(to);
    setWarehouseMovements([]);
    setWarehouseMovementsMeta(null);
    setMovementsLoaded(true);
    void loadWarehouseMovements('', from, to);
  }, [loadWarehouseMovements]);

  useEffect(() => {
    if (
      warehouseTab === 'movements'
      && warehouseInfo?.ref
      && !movementsLoaded
      && !movementsLoading
    ) {
      void loadWarehouseMovements();
    }
  }, [warehouseTab, warehouseInfo?.ref, movementsLoaded, movementsLoading, loadWarehouseMovements]);

  const handleSelectCandidate = useCallback((warehouseRef) => {
    setMovementsLoaded(false);
    setWarehouseMovements([]);
    setWarehouseMovementsMeta(null);
    setWarehouseTab('balances');
    void loadWarehouseData(warehouseRef);
  }, [loadWarehouseData]);

  const returnState = useCallback(() => {
    const base = {
      returnTo: '/database',
      returnLabel: ownerNo ? 'Назад к сотруднику' : 'Назад к результату поиска',
      reopenEmployee: {
        ownerNo,
        employeeName,
        warehouseRef: warehouseInfo?.ref || warehouseRef || '',
      },
    };
    if (typeof buildWarehouseReturnContext === 'function') {
      return buildWarehouseReturnContext(base);
    }
    return base;
  }, [buildWarehouseReturnContext, employeeName, ownerNo, warehouseInfo?.ref, warehouseRef]);

  const handleOpenWarehousePage = useCallback((warehouse) => {
    if (!warehouse?.ref) return;
    const params = new URLSearchParams({
      tab: 'balances',
      warehouseRef: warehouse.ref,
      warehouseName: warehouse.name || '',
    });
    navigate(`/warehouse-1c?${params.toString()}`, { state: returnState() });
  }, [navigate, returnState]);

  const handleOpenBalanceInWarehouse1C = useCallback((row, warehouse) => {
    if (!row?.nomenclature_ref) return;
    const params = new URLSearchParams({
      tab: 'balances',
      nomenclatureRef: row.nomenclature_ref,
      nomenclatureName: row.nomenclature_name || '',
      nomenclatureCode: row.nomenclature_code || '',
    });
    if (warehouse?.ref) {
      params.set('warehouseRef', warehouse.ref);
      if (warehouse.name) params.set('warehouseName', warehouse.name);
    } else if (row.warehouse_ref) {
      params.set('warehouseRef', row.warehouse_ref);
      if (row.warehouse_name) params.set('warehouseName', row.warehouse_name);
    }
    navigate(`/warehouse-1c?${params.toString()}`, { state: returnState() });
  }, [navigate, returnState]);

  const handleOpenBalanceRow = useCallback((row, warehouse) => {
    if (!row?.nomenclature_ref && !row?.nomenclature_code && !row?.nomenclature_name) return;
    setHubMatchRow(row);
    setHubMatchWarehouse(warehouse || null);
    setHubMatchOpen(true);
  }, []);

  const handleCloseHubMatch = useCallback(() => {
    setHubMatchOpen(false);
    setHubMatchRow(null);
    setHubMatchWarehouse(null);
  }, []);

  const handleOpenInvNo = useCallback((invNo, meta = {}) => {
    onOpenInvNo?.(invNo, meta);
  }, [onOpenInvNo]);

  const handleOpenHistory = useCallback((item) => {
    const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
    if (!invNo || invNo === '-') return;
    setHistoryState({ open: true, invNo, loading: true, error: '', rows: [] });
    equipmentRecordsAPI.getEquipmentHistory(invNo)
      .then((data) => {
        setHistoryState((prev) => (prev.open && prev.invNo === invNo
          ? { ...prev, loading: false, rows: Array.isArray(data?.history) ? data.history : [] }
          : prev));
      })
      .catch((err) => {
        console.error('Failed to load equipment history:', err);
        setHistoryState((prev) => (prev.open && prev.invNo === invNo
          ? {
            ...prev,
            loading: false,
            error: resolveWarehouseErrorMessage(err, 'Не удалось загрузить историю передач.'),
          }
          : prev));
      });
  }, []);

  const handleCloseHistory = useCallback(() => {
    setHistoryState((prev) => ({ ...prev, open: false }));
  }, []);

  const discrepanciesText = useMemo(() => {
    const lines = [`Сверка с 1С — ${employeeName || 'сотрудник'}`];
    if (!comparisonComplete) {
      lines.push('Полный снимок остатков 1С недоступен; итоговая сверка не сформирована.');
      return lines.join('\n');
    }
    for (const item of Array.isArray(hubItems) ? hubItems : []) {
      const partNo = readFirst(item, ['PART_NO', 'part_no'], '');
      const status = resolveHubRowStatus(partNo, compareMaps);
      if (status !== 'diff' && status !== 'only_hub') continue;
      const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
      const model = readFirst(item, ['MODEL_NAME', 'model_name'], '');
      const breakdown = compareQtyBreakdown(partNo, compareMaps);
      const tail = status === 'diff' && breakdown
        ? `Хаб: ${breakdown.hubCount} / 1С: ${formatWarehouseQty(breakdown.qty1c)}`
        : 'только в Хабе';
      lines.push(`• ${invNo} · ${model} — ${tail}`);
    }
    for (const row of Array.isArray(warehouseBalances) ? warehouseBalances : []) {
      if (resolve1cRowStatus(row?.nomenclature_code, compareMaps) !== 'only_1c') continue;
      lines.push(`• ${row?.nomenclature_code || '—'} ${row?.nomenclature_name || ''} — только в 1С (${formatWarehouseQty(row?.qty_balance)})`);
    }
    if (lines.length === 1) lines.push('Расхождений нет.');
    return lines.join('\n');
  }, [employeeName, comparisonComplete, hubItems, warehouseBalances, compareMaps]);

  const [inventoryTaskOpen, setInventoryTaskOpen] = useState(false);

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

  const handleExportExcel = useCallback(async () => {
    setExportError('');
    setExporting(true);
    try {
      let movements = warehouseMovements;
      if (canViewWarehouse1C && warehouseInfo?.ref && !movementsLoaded) {
        try {
          const data = await warehouse1cAPI.getWarehouseMovements({
            warehouseRef: warehouseInfo.ref,
            limit: 500,
            dateFrom: movementsDateFrom,
            dateTo: movementsDateTo,
          });
          movements = Array.isArray(data?.items) ? data.items : [];
        } catch (err) {
          console.warn('Failed to load movements for export:', err);
          movements = [];
        }
      }
      await exportEmployeeEquipmentWorkbook({
        employeeName,
        hubItems: visibleHubItems,
        warehouseBalances: visibleWarehouseBalances,
        warehouseName: warehouseInfo?.name || '',
        warehouseStatus: warehouseLoaded ? warehouseStatus : '',
        includeWarehouse: canViewWarehouse1C,
        filterText: sharedFilter,
        statusFilter: statusFilterActive ? statusFilter : '',
        typeFilter,
        compareMaps: canViewWarehouse1C ? compareMaps : null,
        movements,
      });
    } catch (err) {
      console.error('Failed to export employee equipment Excel:', err);
      setExportError('Не удалось выгрузить Excel. Попробуйте ещё раз.');
    } finally {
      setExporting(false);
    }
  }, [
    canViewWarehouse1C,
    compareMaps,
    employeeName,
    movementsDateFrom,
    movementsDateTo,
    movementsLoaded,
    sharedFilter,
    statusFilter,
    statusFilterActive,
    typeFilter,
    visibleHubItems,
    visibleWarehouseBalances,
    warehouseInfo?.name,
    warehouseInfo?.ref,
    warehouseLoaded,
    warehouseMovements,
    warehouseStatus,
  ]);

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
      scroll="paper"
      disableEnforceFocus={disableEnforceFocus}
      sx={stackAboveParent ? {
        // Keep above EquipmentDetailDialog (and beat ModalManager inline z-index).
        zIndex: (t) => `${t.zIndex.modal + 2} !important`,
      } : undefined}
      PaperProps={{
        sx: {
          height: isMobile ? '100%' : 'min(90vh, 920px)',
          maxHeight: isMobile ? '100%' : '90vh',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle
        sx={{
          pr: 6,
          flexShrink: 0,
          pt: isMobile ? 'calc(env(safe-area-inset-top) + 12px)' : undefined,
        }}
      >
        Оборудование сотрудника
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: isMobile ? 'calc(env(safe-area-inset-top) + 4px)' : 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Typography variant="h6" sx={{ mb: 1.5, flexShrink: 0 }}>
          <EmployeeNameLink name={employeeName} />
        </Typography>

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          flexWrap="wrap"
          sx={{ mb: 1.5, flexShrink: 0 }}
        >
          <TextField
            size="small"
            label="Поиск"
            placeholder="Инв. №, модель, серийник, парт. №, номенклатура 1С…"
            value={sharedFilter}
            onChange={(event) => setSharedFilter(event.target.value)}
            sx={{ flex: '1 1 220px', minWidth: 180 }}
          />
          <TextField
            select
            size="small"
            label="Тип оборудования"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            InputLabelProps={{ shrink: true }}
            SelectProps={{ displayEmpty: true }}
            sx={{ flex: '0 1 200px', minWidth: 160 }}
          >
            <MenuItem value="">Все типы</MenuItem>
            {equipmentTypes.map((type) => (
              <MenuItem key={type} value={type}>{type}</MenuItem>
            ))}
          </TextField>
          {canViewWarehouse1C ? (
            <TextField
              select
              size="small"
              label="Статус сверки"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              InputLabelProps={{ shrink: true }}
              SelectProps={{ displayEmpty: true }}
              sx={{ flex: '0 1 190px', minWidth: 150 }}
            >
              <MenuItem value="">Все статусы</MenuItem>
              <MenuItem value="match">{COMPARE_STATUS_LABEL.match}</MenuItem>
              <MenuItem value="diff">{COMPARE_STATUS_LABEL.diff}</MenuItem>
              <MenuItem value="only_hub">{COMPARE_STATUS_LABEL.only_hub}</MenuItem>
              <MenuItem value="only_1c">{COMPARE_STATUS_LABEL.only_1c}</MenuItem>
              <MenuItem value="none">Без парт. № / кода</MenuItem>
            </TextField>
          ) : null}
        </Stack>

        {statusCounts || hubItems.length ? (
          <Stack
            direction="row"
            spacing={0.75}
            useFlexGap
            flexWrap="wrap"
            sx={{ mb: 1.5, flexShrink: 0 }}
          >
            {statusCounts ? [
              ['match', COMPARE_STATUS_LABEL.match, 'success'],
              ['diff', COMPARE_STATUS_LABEL.diff, 'warning'],
              ['only_hub', COMPARE_STATUS_LABEL.only_hub, 'error'],
              ['only_1c', COMPARE_STATUS_LABEL.only_1c, 'info'],
              ['none', 'Без парт. №', 'default'],
            ].map(([key, label, color]) => (
              <Chip
                key={key}
                size="small"
                color={color === 'default' ? undefined : color}
                variant={statusFilter === key ? 'filled' : 'outlined'}
                label={`${label}: ${statusCounts[key]}`}
                onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
              />
            )) : null}
            {hubItems.length ? (
              <Chip
                size="small"
                color={noActFilter ? 'primary' : 'default'}
                variant={noActFilter ? 'filled' : 'outlined'}
                label={`Без акта: ${noActCount}`}
                onClick={() => setNoActFilter((prev) => !prev)}
              />
            ) : null}
            {equipmentTypes.length > 1 ? (
              <Chip
                size="small"
                color={groupByType ? 'primary' : 'default'}
                variant={groupByType ? 'filled' : 'outlined'}
                label="По типам"
                onClick={() => setGroupByType((prev) => !prev)}
              />
            ) : null}
          </Stack>
        ) : null}

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems="stretch"
          divider={canViewWarehouse1C && !isMobile ? <Divider flexItem orientation="vertical" /> : null}
          sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Stack
              direction="row"
              alignItems="flex-start"
              sx={{ minHeight: COLUMN_HEADER_MIN_HEIGHT, mb: 1, pt: 0.5, flexShrink: 0 }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                В Хабе
                {!hubLoading && hubItems.length > 0 ? (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {filterActive ? `${visibleHubItems.length} из ${hubItems.length}` : hubItems.length}
                  </Typography>
                ) : null}
              </Typography>
            </Stack>
            <HubEquipmentTable
              items={visibleHubItems}
              loading={hubLoading}
              error={hubError}
              isMobile={isMobile}
              filterActive={filterActive}
              emptyMessage={!ownerNo ? 'Сотрудник не найден в справочнике Хаба.' : ''}
              onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null}
              onOpenCurrentAct={openCurrentAct}
              openingCurrentActDocNo={openingCurrentActDocNo}
              compareMaps={canViewWarehouse1C ? compareMaps : null}
              sortKey={hubSort.key}
              sortDir={hubSort.dir}
              onSort={(key) => setHubSort((prev) => toggleSortState(prev, key))}
              onOpenHistory={handleOpenHistory}
              groupByType={groupByType}
            />
          </Box>

          {canViewWarehouse1C ? (
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {isMobile ? <Divider sx={{ my: 0.5, flexShrink: 0 }} /> : null}
              <Warehouse1CBalancesPanel
                visible
                loading={warehouseLoading}
                balancesLoading={warehouseBalancesLoading}
                error={warehouseError}
                status={warehouseLoaded ? warehouseStatus : ''}
                warehouse={warehouseInfo}
                candidates={warehouseCandidates}
                balances={warehouseBalances}
                balancesMeta={warehouseBalancesMeta}
                compareMaps={compareMaps}
                filterText={sharedFilter}
                statusFilter={statusFilterActive ? statusFilter : ''}
                allowedCodes={allowed1cCodes}
                typeFilterName={typeFilter}
                whSortKey={warehouseSort.key}
                whSortDir={warehouseSort.dir}
                onSortWarehouse={(key) => setWarehouseSort((prev) => toggleSortState(prev, key))}
                groupByType={groupByType}
                typeByPartKey={typeByPartKey}
                employmentStatus={employmentStatus}
                employmentLabel={employmentLabel}
                isMobile={isMobile}
                activeTab={warehouseTab}
                onTabChange={setWarehouseTab}
                movements={warehouseMovements}
                movementsLoading={movementsLoading}
                movementsError={movementsError}
                movementsMeta={warehouseMovementsMeta}
                movementsDateFrom={movementsDateFrom}
                movementsDateTo={movementsDateTo}
                onMovementsDatesChange={handleMovementsDatesChange}
                onLoadMoreMovements={handleLoadMoreMovements}
                onOpenMovement={movementDetail.openMovement}
                onSelectCandidate={handleSelectCandidate}
                onOpenWarehousePage={handleOpenWarehousePage}
                onOpenBalanceRow={handleOpenBalanceRow}
                onOpenInWarehouse1C={handleOpenBalanceInWarehouse1C}
              />
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      {exportError ? (
        <Alert severity="error" sx={{ mx: 2, mb: 0 }}>{exportError}</Alert>
      ) : null}
      <DialogActions
        sx={{
          flexShrink: 0,
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          pb: isMobile ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined,
        }}
      >
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
            onClick={handleExportExcel}
            disabled={exportDisabled}
            aria-label="Выгрузить в Excel"
          >
            {exporting ? 'Готовлю…' : 'Выгрузить в Excel'}
          </Button>
          {canViewWarehouse1C ? (
            <Button
              variant="text"
              startIcon={copiedDiscrepancies ? undefined : <ContentCopyIcon />}
              onClick={handleCopyDiscrepancies}
              disabled={!comparisonComplete || copiedDiscrepancies}
            >
              {copiedDiscrepancies ? 'Скопировано' : 'Скопировать расхождения'}
            </Button>
          ) : null}
          {canViewWarehouse1C ? (
            <Button
              variant="text"
              onClick={() => setInventoryTaskOpen(true)}
              disabled={!comparisonComplete}
            >
              Задача на инвентаризацию
            </Button>
          ) : null}
        </Stack>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>

    <DocumentPreviewDialog
      open={Boolean(currentActPreview?.open)}
      title={currentActPreview?.title || 'Акт'}
      subtitle={currentActPreview?.subtitle || ''}
      kind={currentActPreview?.kind || 'pdf'}
      objectUrl={currentActPreview?.objectUrl || ''}
      loading={Boolean(currentActPreview?.loading)}
      error={currentActPreview?.error || ''}
      onClose={closeCurrentActPreview}
      onDownloadOriginal={currentActPreview?.previewBlob && currentActPreview?.objectUrl ? () => {
        const link = document.createElement('a');
        link.href = currentActPreview.objectUrl;
        link.download = currentActPreview.title || 'act.pdf';
        link.click();
      } : undefined}
      canDownloadOriginal={Boolean(currentActPreview?.previewBlob)}
    />

    <HubNomenclatureMatchDialog
      open={hubMatchOpen}
      row={hubMatchRow}
      warehouse={hubMatchWarehouse}
      ownerNo={ownerNo}
      employeeName={employeeName || ''}
      onClose={handleCloseHubMatch}
      onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null}
      onOpenInWarehouse1C={handleOpenBalanceInWarehouse1C}
      stackAboveParent={stackAboveParent}
    />

    <MovementDetailDialog
      {...movementDetail.dialogProps}
      fullScreen={isMobile}
    />

    <MailAttachmentPreviewDialog
      {...movementDetail.previewDialogProps}
      maxPreviewFileBytes={MAX_PREVIEW_FILE_BYTES}
    />

    <EquipmentHistoryDialog
      open={historyState.open}
      invNo={historyState.invNo}
      rows={historyState.rows}
      loading={historyState.loading}
      error={historyState.error}
      onClose={handleCloseHistory}
      fullScreen={isMobile}
    />

    <InventoryTaskDialog
      open={inventoryTaskOpen}
      employeeName={employeeName}
      description={discrepanciesText}
      onClose={() => setInventoryTaskOpen(false)}
      onOpenTasks={() => {
        setInventoryTaskOpen(false);
        navigate('/tasks');
      }}
    />
    </>
  );
}
