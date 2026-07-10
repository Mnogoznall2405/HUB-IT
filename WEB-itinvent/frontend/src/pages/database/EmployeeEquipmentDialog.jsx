import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
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
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { equipmentSearchAPI } from '../../api/equipmentSearch';
import { warehouse1cAPI } from '../../api/warehouse1c';
import { LoadingSpinner } from '../../components/common';
import EmploymentStatusChip from '../../components/EmploymentStatusChip';
import { readFirst } from './databaseRecordModel';
import EmployeeNameLink from './EmployeeNameLink';
import {
  formatWarehouseQty,
  NomenclatureCell,
  resolveWarehouseErrorMessage,
} from './warehouse1cShared';

function HubEquipmentTable({ items, loading, error, onOpenInvNo }) {
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
        У сотрудника нет закреплённого оборудования в Хабе.
      </Typography>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Инв. №</TableCell>
            <TableCell>Модель</TableCell>
            <TableCell>Серийник</TableCell>
            <TableCell>Парт. №</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const invNo = readFirst(item, ['INV_NO', 'inv_no'], '-');
            const canOpen = Boolean(onOpenInvNo && invNo && invNo !== '-');
            return (
              <TableRow
                key={invNo}
                hover
                onClick={canOpen ? () => onOpenInvNo(invNo) : undefined}
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
                        onOpenInvNo(invNo);
                      }}
                    >
                      {invNo}
                    </Link>
                  ) : invNo}
                </TableCell>
                <TableCell>{readFirst(item, ['MODEL_NAME', 'model_name'], '-')}</TableCell>
                <TableCell>{readFirst(item, ['SERIAL_NO', 'serial_no', 'HW_SERIAL_NO', 'hw_serial_no'], '-')}</TableCell>
                <TableCell>{readFirst(item, ['PART_NO', 'part_no'], '-')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function Warehouse1CBalancesPanel({
  visible,
  loading,
  error,
  status,
  warehouse,
  candidates,
  balances,
  employmentStatus = '',
  employmentLabel = '',
  onSelectCandidate,
  onOpenWarehousePage,
  onOpenBalanceRow,
}) {
  if (!visible) return null;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }} useFlexGap flexWrap="wrap">
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
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
          >
            Открыть в Складе 1С
          </Button>
        ) : null}
      </Stack>

      {loading ? <LoadingSpinner message="Запрос к 1С..." /> : null}
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}

      {!loading && !error && status === 'not_found' ? (
        <Alert severity="info">
          Склад 1С для этого сотрудника не найден. Проверьте, что склад в 1С назван по ФИО
          (полностью или с инициалами, например «Рябов А.С.»).
        </Alert>
      ) : null}

      {!loading && !error && status === 'ambiguous' ? (
        <Box>
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

      {!loading && !error && status === 'matched' && warehouse ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Склад: {warehouse.name}
        </Typography>
      ) : null}

      {!loading && !error && balances.length > 0 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Номенклатура</TableCell>
                <TableCell align="right">Кол-во</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {balances.map((row, index) => (
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      {!loading && !error && status === 'matched' && balances.length === 0 ? (
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
  onClose,
  onOpenInvNo = null,
  buildWarehouseReturnContext = null,
}) {
  const navigate = useNavigate();
  const [hubItems, setHubItems] = useState([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');

  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState('');
  const [warehouseStatus, setWarehouseStatus] = useState('');
  const [warehouseInfo, setWarehouseInfo] = useState(null);
  const [warehouseCandidates, setWarehouseCandidates] = useState([]);
  const [warehouseBalances, setWarehouseBalances] = useState([]);
  const [warehouseLoaded, setWarehouseLoaded] = useState(false);
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [employmentLabel, setEmploymentLabel] = useState('');

  const resetWarehouseState = useCallback(() => {
    setWarehouseLoading(false);
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
      resetWarehouseState();
      return undefined;
    }

    let cancelled = false;
    setHubLoading(true);
    setHubError('');
    resetWarehouseState();

    const hubPromise = equipmentSearchAPI.getEmployeeEquipment(ownerNo)
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
        loadBalances: true,
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
  }, [open, ownerNo, employeeName, canViewWarehouse1C, resetWarehouseState]);

  const loadWarehouseData = useCallback(async (warehouseRef = '') => {
    if (!canViewWarehouse1C || !employeeName) return;

    setWarehouseLoading(true);
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

  const handleOpenBalanceRow = useCallback((row, warehouse) => {
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

  const handleOpenInvNo = useCallback((invNo) => {
    onOpenInvNo?.(invNo);
  }, [onOpenInvNo]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      <DialogTitle sx={{ pr: 6 }}>
        Оборудование сотрудника
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="h6" sx={{ mb: 2 }}>
          <EmployeeNameLink name={employeeName} />
        </Typography>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          divider={canViewWarehouse1C ? <Divider flexItem orientation="vertical" /> : null}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              В Хабе
            </Typography>
            <HubEquipmentTable
              items={hubItems}
              loading={hubLoading}
              error={hubError}
              onOpenInvNo={onOpenInvNo ? handleOpenInvNo : null}
            />
          </Box>

          {canViewWarehouse1C ? (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Warehouse1CBalancesPanel
                visible
                loading={warehouseLoading}
                error={warehouseError}
                status={warehouseLoaded ? warehouseStatus : ''}
                warehouse={warehouseInfo}
                candidates={warehouseCandidates}
                balances={warehouseBalances}
                employmentStatus={employmentStatus}
                employmentLabel={employmentLabel}
                onSelectCandidate={handleSelectCandidate}
                onOpenWarehousePage={handleOpenWarehousePage}
                onOpenBalanceRow={handleOpenBalanceRow}
              />
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
