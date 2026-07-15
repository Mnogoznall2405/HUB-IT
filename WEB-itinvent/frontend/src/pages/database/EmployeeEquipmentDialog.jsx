import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { equipmentSearchAPI } from '../../api/equipmentSearch';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { LoadingSpinner } from '../../components/common';
import EmploymentStatusChip from '../../components/EmploymentStatusChip';
import { readFirst } from './databaseRecordModel';
import EmployeeNameLink from './EmployeeNameLink';
import HubNomenclatureMatchDialog from './HubNomenclatureMatchDialog';
import {
  filterBalancesByText,
  formatWarehouseQty,
  NomenclatureCell,
  resolveWarehouseErrorMessage,
  sortBalancesByNomenclature,
} from './warehouse1cShared';

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

function HubEquipmentMobileRow({ item, onOpenInvNo, showDbChip = false }) {
  const [expanded, setExpanded] = useState(false);
  const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
  const model = readFirst(item, ['MODEL_NAME', 'model_name'], '-');
  const serial = readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], '-');
  const partNo = readFirst(item, ['PART_NO', 'part_no'], '-');
  const { databaseId } = hubItemDatabaseMeta(item);
  const openMeta = databaseId ? { databaseId } : {};
  const canOpen = Boolean(onOpenInvNo && invNo && invNo !== '-');
  const hasDetails = (serial && serial !== '-') || (partNo && partNo !== '-');

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
        onClick={canOpen ? () => onOpenInvNo(invNo, openMeta) : undefined}
        onKeyDown={canOpen ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenInvNo(invNo, openMeta);
          }
        } : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.9,
          minHeight: 52,
          cursor: canOpen ? 'pointer' : 'default',
        }}
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
        </Box>
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

function HubEquipmentTable({ items, loading, error, onOpenInvNo, isMobile = false, filterActive = false }) {
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
        {filterActive
          ? 'По фильтру в Хабе ничего не найдено.'
          : 'У сотрудника нет закреплённого оборудования в Хабе.'}
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
        {items.map((item, index) => {
          const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
          const { databaseId } = hubItemDatabaseMeta(item);
          return (
            <HubEquipmentMobileRow
              key={`${databaseId || 'db'}|${invNo}|${index}`}
              item={item}
              onOpenInvNo={onOpenInvNo}
              showDbChip={showDbChip}
            />
          );
        })}
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
            <TableCell>Инв. №</TableCell>
            <TableCell>Модель</TableCell>
            <TableCell>Серийник</TableCell>
            <TableCell>Парт. №</TableCell>
            {showDbChip ? <TableCell>База</TableCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, index) => {
            const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
            const { databaseId } = hubItemDatabaseMeta(item);
            const openMeta = databaseId ? { databaseId } : {};
            const canOpen = Boolean(onOpenInvNo && invNo && invNo !== '-');
            return (
              <TableRow
                key={`${databaseId || 'db'}|${invNo}|${index}`}
                hover
                onClick={canOpen ? () => onOpenInvNo(invNo, openMeta) : undefined}
                sx={canOpen ? { cursor: 'pointer' } : undefined}
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
                <TableCell>{readFirst(item, ['MODEL_NAME', 'model_name'], '-')}</TableCell>
                <TableCell>{readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], '-')}</TableCell>
                <TableCell>{readFirst(item, ['PART_NO', 'part_no'], '-')}</TableCell>
                {showDbChip ? (
                  <TableCell>
                    <HubDbChip item={item} show />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function WarehouseBalanceMobileRow({ row, warehouse, onOpenBalanceRow, onOpenInWarehouse1C }) {
  const clickable = Boolean(onOpenBalanceRow && row?.nomenclature_ref);
  return (
    <Box
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onOpenBalanceRow(row, warehouse) : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenBalanceRow(row, warehouse);
        }
      } : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1,
        py: 0.9,
        minHeight: 52,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
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

function Warehouse1CBalancesPanel({
  visible,
  loading,
  balancesLoading,
  error,
  status,
  warehouse,
  candidates,
  balances,
  filterText = '',
  employmentStatus = '',
  employmentLabel = '',
  isMobile = false,
  onSelectCandidate,
  onOpenWarehousePage,
  onOpenBalanceRow,
  onOpenInWarehouse1C,
}) {
  const visibleBalances = useMemo(() => {
    const sorted = sortBalancesByNomenclature(balances);
    return filterBalancesByText(sorted, filterText);
  }, [balances, filterText]);

  if (!visible) return null;

  const filterActive = Boolean(String(filterText || '').trim());

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

      {loading ? <LoadingSpinner message="Поиск склада в 1С..." /> : null}
      {!loading && status === 'matched' && warehouse?.name ? (
        <Typography data-testid="employee-warehouse-name" variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          {warehouse.name}
        </Typography>
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
            {visibleBalances.map((row, index) => (
              <WarehouseBalanceMobileRow
                key={`${row.nomenclature_ref || row.nomenclature_name}|${index}`}
                row={row}
                warehouse={warehouse}
                onOpenBalanceRow={onOpenBalanceRow}
                onOpenInWarehouse1C={onOpenInWarehouse1C}
              />
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
                  <TableCell>Номенклатура</TableCell>
                  <TableCell align="right">Кол-во</TableCell>
                  <TableCell align="center" sx={{ width: 48 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleBalances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        {filterActive ? 'По фильтру в 1С ничего не найдено.' : 'Позиций нет.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
                {visibleBalances.map((row, index) => (
                  <TableRow
                    key={`${row.nomenclature_ref || row.nomenclature_name}|${index}`}
                    hover
                    onClick={() => onOpenBalanceRow?.(row, warehouse)}
                    sx={{ cursor: onOpenBalanceRow ? 'pointer' : 'default' }}
                  >
                    <TableCell>
                      <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
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
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      ) : null}

      {!loading && !balancesLoading && !error && status === 'matched' && balances.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          На складе нет позиций с ненулевым конечным остатком.
        </Typography>
      ) : null}
    </Box>
  );
}

export default function EmployeeEquipmentDialog({
  open,
  ownerNo,
  employeeName,
  canViewWarehouse1C = false,
  allowCrossDatabase = false,
  onClose,
  onOpenInvNo = null,
  buildWarehouseReturnContext = null,
}) {
  const navigate = useNavigate();
  const theme = useTheme();
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: false });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: false });
  const isMobile = isNarrowMobile || isTouchMobile;

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
  const [warehouseLoaded, setWarehouseLoaded] = useState(false);
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [employmentLabel, setEmploymentLabel] = useState('');
  const [hubMatchOpen, setHubMatchOpen] = useState(false);
  const [hubMatchRow, setHubMatchRow] = useState(null);
  const [hubMatchWarehouse, setHubMatchWarehouse] = useState(null);
  const [sharedFilter, setSharedFilter] = useState('');

  const filterActive = Boolean(String(sharedFilter || '').trim());
  const visibleHubItems = useMemo(
    () => filterHubItemsByText(hubItems, sharedFilter),
    [hubItems, sharedFilter],
  );

  const resetWarehouseState = useCallback(() => {
    setWarehouseLoading(false);
    setWarehouseBalancesLoading(false);
    setWarehouseError('');
    setWarehouseStatus('');
    setWarehouseInfo(null);
    setWarehouseCandidates([]);
    setWarehouseBalances([]);
    setWarehouseLoaded(false);
    setEmploymentStatus('');
    setEmploymentLabel('');
  }, []);

  useEffect(() => {
    if (!open || !ownerNo) {
      setHubItems([]);
      setHubError('');
      setHubLoading(false);
      setSharedFilter('');
      resetWarehouseState();
      return undefined;
    }

    let cancelled = false;
    setHubLoading(true);
    setHubError('');
    setSharedFilter('');
    resetWarehouseState();

    const hubPromise = equipmentSearchAPI.getEmployeeEquipment(ownerNo, {
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
      });

    let warehousePromise = Promise.resolve();
    if (canViewWarehouse1C && employeeName) {
      setWarehouseLoading(true);
      warehousePromise = warehouse1cAPI.getEmployeeWarehouse({
        employeeName,
        warehouseRef: '',
        loadBalances: false,
      })
        .then((data) => {
          if (cancelled) return;
          setWarehouseStatus(data?.status || '');
          setWarehouseInfo(data?.warehouse || null);
          setWarehouseCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
          setWarehouseBalances(Array.isArray(data?.balances) ? data.balances : []);
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
  }, [open, ownerNo, employeeName, canViewWarehouse1C, allowCrossDatabase, resetWarehouseState]);

  const loadWarehouseData = useCallback(async (warehouseRef = '') => {
    if (!canViewWarehouse1C || !employeeName) return;

    setWarehouseLoading(true);
    setWarehouseBalancesLoading(true);
    setWarehouseError('');
    try {
      const data = await warehouse1cAPI.getEmployeeWarehouse({
        employeeName,
        warehouseRef,
        loadBalances: true,
      });
      setWarehouseStatus(data?.status || '');
      setWarehouseInfo(data?.warehouse || null);
      setWarehouseCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
      setWarehouseBalances(Array.isArray(data?.balances) ? data.balances : []);
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
      setWarehouseLoaded(true);
    } finally {
      setWarehouseLoading(false);
      setWarehouseBalancesLoading(false);
    }
  }, [canViewWarehouse1C, employeeName]);

  const handleSelectCandidate = useCallback((warehouseRef) => {
    void loadWarehouseData(warehouseRef);
  }, [loadWarehouseData]);

  const returnState = useCallback(() => {
    const base = {
      returnTo: '/database',
      returnLabel: 'Назад к сотруднику',
      reopenEmployee: {
        ownerNo,
        employeeName,
      },
    };
    if (typeof buildWarehouseReturnContext === 'function') {
      return buildWarehouseReturnContext(base);
    }
    return base;
  }, [buildWarehouseReturnContext, ownerNo, employeeName]);

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

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
      scroll="paper"
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

        <TextField
          size="small"
          fullWidth
          label="Поиск"
          placeholder="Инв. №, модель, серийник, парт. №, номенклатура 1С…"
          value={sharedFilter}
          onChange={(event) => setSharedFilter(event.target.value)}
          sx={{ mb: 2, flexShrink: 0 }}
        />

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
              alignItems="center"
              sx={{ minHeight: 40, mb: 1, flexShrink: 0 }}
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
              onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null}
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
                filterText={sharedFilter}
                employmentStatus={employmentStatus}
                employmentLabel={employmentLabel}
                isMobile={isMobile}
                onSelectCandidate={handleSelectCandidate}
                onOpenWarehousePage={handleOpenWarehousePage}
                onOpenBalanceRow={handleOpenBalanceRow}
                onOpenInWarehouse1C={handleOpenBalanceInWarehouse1C}
              />
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexShrink: 0, pb: isMobile ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined }}>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>

    <HubNomenclatureMatchDialog
      open={hubMatchOpen}
      row={hubMatchRow}
      warehouse={hubMatchWarehouse}
      ownerNo={ownerNo}
      employeeName={employeeName || ''}
      onClose={handleCloseHubMatch}
      onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null}
      onOpenInWarehouse1C={handleOpenBalanceInWarehouse1C}
    />
    </>
  );
}
