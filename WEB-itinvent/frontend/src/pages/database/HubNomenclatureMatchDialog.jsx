import { useEffect, useState } from 'react';
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
  IconButton,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { warehouse1cAPI } from '../../api/warehouse1c';
import { useAuth } from '../../contexts/AuthContext';
import {
  HUB_PART_NO_NOT_IN_1C,
  NomenclatureCell,
  formatWarehouseQty,
  isPendingHubPartNo,
  resolveWarehouseErrorMessage,
} from './warehouse1cShared';

function MatchItemRow({
  item,
  nomenclatureCode = '',
  nomenclatureRef = '',
  onOpenInvNo,
  onApplied,
  allowApply = false,
}) {
  const invNo = String(item?.inv_no || '').trim();
  const canOpen = Boolean(invNo && invNo !== '-' && onOpenInvNo);
  const serial = String(item?.serial_no || item?.hw_serial_no || '').trim();
  const partNo = String(item?.part_no || '').trim();
  const model = String(item?.model_name || '').trim() || '—';
  const dbName = String(item?.hub_db_name || item?.hub_db_id || '').trim();
  const databaseId = String(item?.hub_db_id || '').trim();
  const code = String(nomenclatureCode || '').trim();
  const nomenclatureRefValue = String(nomenclatureRef || '').trim();
  const expectedVersion = Number(item?.expected_version ?? item?.one_c_link?.version ?? 0) || 0;
  const canApplyCode = Boolean(
    allowApply && invNo && code && nomenclatureRefValue && isPendingHubPartNo(partNo),
  );
  const canMarkNotIn1c = Boolean(allowApply && invNo && isPendingHubPartNo(partNo));

  const [busy, setBusy] = useState('');
  const [localError, setLocalError] = useState('');

  const runAction = async (actionKey, runner) => {
    setBusy(actionKey);
    setLocalError('');
    try {
      await runner();
      if (onApplied) onApplied();
    } catch (err) {
      console.error('Failed to update PART_NO from match dialog:', err);
      setLocalError(resolveWarehouseErrorMessage(err, 'Не удалось обновить парт. номер.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <Box
      sx={{
        px: 1.25,
        py: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: item?.is_current_owner ? 'action.selected' : 'transparent',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {item?.employee_name || 'Сотрудник не указан'}
            </Typography>
            {item?.is_current_owner ? (
              <Chip size="small" color="primary" label="этот" sx={{ height: 22 }} />
            ) : null}
            {dbName ? (
              <Chip
                size="small"
                variant="outlined"
                color={item?.is_current_db ? 'primary' : 'default'}
                label={dbName}
                sx={{ height: 22 }}
              />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {model}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Инв. №:{' '}
            {canOpen ? (
              <Link
                component="button"
                type="button"
                variant="caption"
                onClick={() => onOpenInvNo(invNo, { databaseId })}
                sx={{ verticalAlign: 'baseline' }}
              >
                {invNo}
              </Link>
            ) : (
              invNo || '—'
            )}
            {serial ? ` · S/N: ${serial}` : ''}
            {partNo ? ` · Парт. №: ${partNo}` : ''}
          </Typography>
          {localError ? (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
              {localError}
            </Typography>
          ) : null}
          {(canApplyCode || canMarkNotIn1c) ? (
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
              {canApplyCode ? (
                <Button
                  size="small"
                  variant="contained"
                  disabled={Boolean(busy)}
                  onClick={() => runAction('apply', () => warehouse1cAPI.applyReconcilePartNo({
                    invNo,
                    nomenclatureRef: nomenclatureRefValue,
                    partNo: code,
                    reason: 'Подтверждено вручную в сверке номенклатуры 1С.',
                    expectedPartNo: partNo,
                    expectedVersion,
                    confirm: true,
                  }))}
                  sx={{ textTransform: 'none' }}
                >
                  {busy === 'apply' ? '…' : `Проставить ${code}`}
                </Button>
              ) : null}
              {canMarkNotIn1c ? (
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  disabled={Boolean(busy)}
                  onClick={() => runAction('mark', () => warehouse1cAPI.markReconcileNotIn1c({
                    invNo,
                    reason: 'Проверено вручную: подходящая номенклатура 1С не найдена.',
                    expectedPartNo: partNo,
                    expectedVersion,
                    confirm: true,
                  }))}
                  sx={{ textTransform: 'none' }}
                >
                  {busy === 'mark' ? '…' : HUB_PART_NO_NOT_IN_1C}
                </Button>
              ) : null}
            </Stack>
          ) : null}
        </Box>
      </Stack>
    </Box>
  );
}

function MatchSection({
  title,
  emptyText,
  items,
  nomenclatureCode = '',
  nomenclatureRef = '',
  onOpenInvNo,
  onApplied,
  allowApply = false,
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
        {title}
        {Array.isArray(items) ? ` (${items.length})` : ''}
      </Typography>
      {!items?.length ? (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          {items.map((item, index) => (
            <MatchItemRow
              key={`${item.inv_no || 'inv'}|${item.owner_no || 'o'}|${index}`}
              item={item}
              nomenclatureCode={nomenclatureCode}
              nomenclatureRef={nomenclatureRef}
              onOpenInvNo={onOpenInvNo}
              onApplied={onApplied}
              allowApply={allowApply}
            />
          ))}
        </Paper>
      )}
    </Box>
  );
}

export default function HubNomenclatureMatchDialog({
  open,
  row = null,
  warehouse = null,
  ownerNo = null,
  employeeName = '',
  warehouseName = '',
  onClose,
  onOpenInvNo = null,
  onOpenInWarehouse1C = null,
}) {
  const { hasPermission } = useAuth();
  const theme = useTheme();
  const isNarrowMobile = useMediaQuery(theme.breakpoints.down('sm'), { defaultMatches: false });
  const isTouchMobile = useMediaQuery('(hover: none) and (pointer: coarse)', { defaultMatches: false });
  const isMobile = isNarrowMobile || isTouchMobile;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exact, setExact] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [needMore, setNeedMore] = useState(false);
  const [matchedCount, setMatchedCount] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [reconcileWriteEnabled, setReconcileWriteEnabled] = useState(false);
  const [reconcileWriteKnown, setReconcileWriteKnown] = useState(false);

  useEffect(() => {
    if (!open) {
      setReconcileWriteEnabled(false);
      setReconcileWriteKnown(false);
      return undefined;
    }
    let cancelled = false;
    warehouse1cAPI.getRuntimeStatus()
      .then((data) => {
        if (cancelled) return;
        setReconcileWriteEnabled(Boolean(data?.reconcile?.write_enabled));
        setReconcileWriteKnown(true);
      })
      .catch(() => {
        if (cancelled) return;
        // The UI must fail closed while the server rollout state is unknown.
        setReconcileWriteEnabled(false);
        setReconcileWriteKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !row) {
      setLoading(false);
      setError('');
      setExact([]);
      setCandidates([]);
      setNeedMore(false);
      setMatchedCount(0);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    setExact([]);
    setCandidates([]);
    setNeedMore(false);
    setMatchedCount(0);

    const resolvedWarehouseName = String(
      warehouseName
      || warehouse?.name
      || row?.warehouse_name
      || '',
    ).trim();

    const qtyRaw = row?.qty_balance;
    const qtyBalance = qtyRaw == null || qtyRaw === '' ? null : Number(qtyRaw);

    warehouse1cAPI.matchNomenclatureToHub({
      nomenclatureCode: row.nomenclature_code || '',
      nomenclatureName: row.nomenclature_name || '',
      nomenclatureRef: row.nomenclature_ref || '',
      ownerNo,
      warehouseName: resolvedWarehouseName,
      employeeName: String(employeeName || '').trim(),
      qtyBalance: Number.isFinite(qtyBalance) ? qtyBalance : null,
    })
      .then((data) => {
        if (cancelled) return;
        setExact(Array.isArray(data?.exact) ? data.exact : []);
        setCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
        setNeedMore(Boolean(data?.need_more));
        setMatchedCount(Number(data?.matched_count) || 0);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to match nomenclature to Hub:', err);
        setError(resolveWarehouseErrorMessage(err, 'Не удалось сверить номенклатуру с Хабом.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, row, ownerNo, warehouse, warehouseName, employeeName, reloadToken]);

  const canOpenWarehouse = Boolean(onOpenInWarehouse1C && row?.nomenclature_ref);
  const nomenclatureCode = String(row?.nomenclature_code || '').trim();
  const nomenclatureRef = String(row?.nomenclature_ref || '').trim();
  const canWriteReconcile = (
    reconcileWriteEnabled
    &&
    hasPermission('warehouse_1c.reconcile.write')
    && hasPermission('database.write')
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      scroll="paper"
    >
      <DialogTitle
        sx={{
          pr: 6,
          pt: isMobile ? 'calc(env(safe-area-inset-top) + 12px)' : undefined,
        }}
      >
        Сверка с Хабом
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: isMobile ? 'calc(env(safe-area-inset-top) + 4px)' : 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {row ? (
          <Stack spacing={1} sx={{ mb: 2 }}>
            <NomenclatureCell code={row.nomenclature_code} name={row.nomenclature_name} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`Остаток: ${formatWarehouseQty(row.qty_balance)}`}
              />
              {warehouse?.name ? (
                <Typography variant="caption" color="text.secondary">
                  Склад: {warehouse.name}
                </Typography>
              ) : null}
            </Stack>
            {canOpenWarehouse ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<OpenInNewIcon />}
                onClick={() => onOpenInWarehouse1C(row, warehouse)}
                sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
              >
                Открыть в Складе 1С
              </Button>
            ) : null}
          </Stack>
        ) : null}

        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Ищем совпадения в Хабе…
            </Typography>
          </Stack>
        ) : null}

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {!canWriteReconcile ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            {!reconcileWriteKnown || !reconcileWriteEnabled
              ? 'Сверка запущена в audit-only режиме: изменение связей временно выключено на сервере.'
              : 'Сверка доступна в режиме просмотра. Для изменения связи нужны права «Склад 1С: изменение сверки» и «База: изменения».'}
          </Alert>
        ) : null}

        {!loading && !error && needMore ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            В 1С остаток {formatWarehouseQty(row?.qty_balance)}, по парт. № в Хабе найдено {matchedCount}.
            Ниже — возможные варианты без парт. номера, чтобы добрать остальные.
          </Alert>
        ) : null}

        {!loading && !error ? (
          <>
            <MatchSection
              title="Совпадения по коду / парт. №"
              emptyText="В Хабе нет единиц с таким парт. номером."
              items={exact}
              onOpenInvNo={onOpenInvNo}
            />
            <MatchSection
              title="Возможные варианты (без парт. №)"
              emptyText={
                needMore
                  ? 'Похожих единиц без парт. номера не найдено — проверьте другие склады или модели.'
                  : 'Похожих единиц без парт. номера не найдено.'
              }
              items={candidates}
              nomenclatureCode={nomenclatureCode}
              nomenclatureRef={nomenclatureRef}
              onOpenInvNo={onOpenInvNo}
              allowApply={canWriteReconcile}
              onApplied={() => setReloadToken((value) => value + 1)}
            />
          </>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ pb: isMobile ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined }}>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
