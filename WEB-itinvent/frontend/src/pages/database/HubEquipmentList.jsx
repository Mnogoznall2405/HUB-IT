import { Fragment, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import { readFirst } from './databaseRecordModel';
import { compareQtyBreakdown, resolveHubRowStatus } from './employeeCompareModel';
import { formatWarehouseQty, statusRowSx } from './warehouse1cShared';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import EquipmentCurrentActIndicator from './EquipmentCurrentActIndicator';
import { hubItemDatabaseMeta } from './employeeCompareFormat';

export function CompareQtyNote({ breakdown }) {
  if (!breakdown) return null;
  return (
    <Typography variant="caption" color="warning.main" sx={{ display: 'block', fontWeight: 600 }}>
      Хаб: {breakdown.hubCount} · 1С: {formatWarehouseQty(breakdown.qty1c)}
    </Typography>
  );
}

export function ActiveUseChip({ info }) {
  if (!info || typeof info !== 'object') return null;
  const hostname = String(info.hostname || '').trim();
  if (!hostname) return null;
  const status = String(info.status || '').trim();
  const isMonitor = String(info.kind || '') === 'monitor';
  const user = String(info.user_login || info.current_user || '').trim();
  const lastSeen = Number(info.last_seen_at || 0);
  const monitorLabel = [info.monitor_manufacturer, info.monitor_product_code]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  const title = [
    isMonitor ? `Монитор: ${monitorLabel || info.monitor_serial_number || '-'}` : `ПК: ${hostname}`,
    isMonitor ? `Подключён к: ${hostname}` : '',
    info.monitor_match === 'serial_suffix' ? 'Совпадение по хвосту серийника' : '',
    info.monitor_match === 'serial_tail' ? 'Совпадение по цифрам серийника' : '',
    user ? `Пользователь: ${user}` : '',
    lastSeen > 0 ? `Отчёт агента: ${new Date(lastSeen * 1000).toLocaleString('ru-RU')}` : '',
  ].filter(Boolean).join('\n');
  const label = isMonitor
    ? `Подключён: ${hostname}`
    : status === 'online' ? `В работе: ${hostname}` : `ПК: ${hostname}`;
  return (
    <Tooltip title={title} sx={{ whiteSpace: 'pre-line' }}>
      <Chip
        size="small"
        variant="outlined"
        color={status === 'online' ? 'success' : status === 'stale' ? 'warning' : 'default'}
        label={label}
        sx={{
          height: 20,
          maxWidth: '100%',
          '& .MuiChip-label': {
            px: 0.75,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        }}
      />
    </Tooltip>
  );
}

export function HubDbChip({ item, show }) {
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

export function HubEquipmentMobileRow({
  item,
  onOpenInvNo,
  onOpenCurrentAct,
  openingCurrentActDocNo,
  showDbChip = false,
  compareMaps = null,
  onOpenHistory,
  activeUseInfo = null,
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
            <ActiveUseChip info={activeUseInfo} />
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

export function HubEquipmentTable({
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
  activeUseByInvNo = null,
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
                  activeUseInfo={activeUseByInvNo?.[invNo] || null}
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
                  {activeUseByInvNo?.[invNo] ? (
                    <Box sx={{ mt: 0.35, maxWidth: 240 }}>
                      <ActiveUseChip info={activeUseByInvNo[invNo]} />
                    </Box>
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

export default HubEquipmentTable;
