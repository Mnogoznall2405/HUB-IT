import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
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
import CloseIcon from '@mui/icons-material/Close';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import { jsonAPI } from '../../api/json_client';
import {
  buildPcCleaningPayload,
  filterRemainingPcs,
  readRemainingPcs,
  readSelectedDatabaseId,
  remainingPcKey,
} from './pcRemaining';

const formatLastCleanedAt = (value) => {
  if (!value) return 'Не чистили';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU');
};

const isSameRemainingPc = (left, right) => {
  const leftInv = String(left?.inv_no || '').trim();
  const rightInv = String(right?.inv_no || '').trim();
  if (leftInv && rightInv) return leftInv === rightInv;
  return String(left?.serial_no || left?.hw_serial_no || '').trim()
    === String(right?.serial_no || right?.hw_serial_no || '').trim();
};

function PcRemainingDialog({
  open = false,
  branchRow = null,
  periodDays = 90,
  canWrite = false,
  onClose,
  onCleaningSaved,
  onNotifySuccess,
  onNotifyError,
  isMobile = false,
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedRemaining, setLoadedRemaining] = useState(null);
  const [loadedTotal, setLoadedTotal] = useState(null);
  const [confirmRow, setConfirmRow] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const branchName = String(branchRow?.branch || '').trim() || 'Филиал';
  const remainingFromLoad = loadedRemaining == null ? null : Number(loadedRemaining);
  const remainingCount = Number.isFinite(remainingFromLoad)
    ? remainingFromLoad
    : (Number(branchRow?.remaining_pc) || items.length);
  const totalCount = Number(loadedTotal ?? branchRow?.total_pc ?? 0) || 0;

  const reloadRemaining = useCallback(() => {
    if (!branchRow?.branch) return Promise.resolve();
    return jsonAPI.getPcCleaningRemaining({
      period_days: periodDays,
      branch: branchRow.branch,
    }).then((response) => {
      const data = response?.data && typeof response.data === 'object'
        ? response.data
        : response;
      setItems(readRemainingPcs(data));
      if (data?.remaining_pc != null) setLoadedRemaining(Number(data.remaining_pc) || 0);
      if (data?.total_pc != null) setLoadedTotal(Number(data.total_pc) || 0);
      return data;
    });
  }, [branchRow, periodDays]);

  useEffect(() => {
    if (!open || !branchRow?.branch) {
      return undefined;
    }

    let cancelled = false;
    const seeded = readRemainingPcs(branchRow);
    setQuery('');
    setError('');
    setItems(seeded);
    setLoadedRemaining(null);
    setLoadedTotal(null);
    setConfirmRow(null);
    setLoading(true);

    reloadRemaining()
      .catch((requestError) => {
        if (cancelled) return;
        if (seeded.length === 0) {
          setError(requestError?.response?.data?.detail || 'Не удалось загрузить список непочищенных ПК');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, branchRow, periodDays, reloadRemaining]);

  const filtered = useMemo(
    () => filterRemainingPcs(items, query),
    [items, query],
  );

  const emptyMessage = (() => {
    if (loading) return 'Загрузка списка ПК...';
    if (error) return error;
    if (items.length === 0 && remainingCount > 0) {
      return 'Список ПК не пришёл с сервера, хотя по покрытию ещё есть непочищенные.';
    }
    if (items.length === 0) {
      return 'За выбранный период все ПК этого филиала почищены';
    }
    return 'Нет ПК по выбранному фильтру';
  })();

  const handleConfirmCleaning = async () => {
    if (!confirmRow || submitting) return;
    const built = buildPcCleaningPayload(confirmRow, {
      branch: branchName,
      dbName: readSelectedDatabaseId(),
    });
    if (built.error) {
      setError(built.error);
      setConfirmRow(null);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await jsonAPI.addPcCleaning(built.payload);
      setItems((prev) => prev.filter((item) => !isSameRemainingPc(item, confirmRow)));
      setLoadedRemaining((prev) => {
        const current = prev == null ? remainingCount : prev;
        return Math.max(0, Number(current) - 1);
      });
      setConfirmRow(null);
      onNotifySuccess?.(`Чистка поставлена: ${confirmRow.inv_no || confirmRow.serial_no || 'ПК'}`);
      onCleaningSaved?.();
    } catch (requestError) {
      const message = requestError?.response?.data?.detail || 'Не удалось поставить чистку';
      setError(message);
      onNotifyError?.(requestError, 'Не удалось поставить чистку');
    } finally {
      setSubmitting(false);
    }
  };

  const tableColSpan = canWrite ? 7 : 6;
  const confirmLabel = confirmRow
    ? (confirmRow.inv_no || confirmRow.serial_no || 'этот ПК')
    : '';

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="md"
        fullScreen={isMobile}
        scroll="paper"
      >
        <DialogTitle sx={{ pr: 6 }}>
          Не почищены: {branchName}
          <IconButton
            aria-label="Закрыть"
            onClick={onClose}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        {loading ? <LinearProgress /> : null}
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {remainingCount} из {totalCount || remainingCount} ПК без чистки за выбранный период
            </Typography>
            {error ? <Alert severity="warning">{error}</Alert> : null}
            <TextField
              size="small"
              label="Поиск по инв. №, серийнику, локации или сотруднику"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Инв. №</TableCell>
                    <TableCell>Серийный номер</TableCell>
                    <TableCell>Модель</TableCell>
                    <TableCell>Локация</TableCell>
                    <TableCell>Сотрудник</TableCell>
                    <TableCell>Последняя чистка</TableCell>
                    {canWrite ? <TableCell align="right">Действие</TableCell> : null}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tableColSpan} align="center">
                        <Typography variant="body2" color="text.secondary">
                          {emptyMessage}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : filtered.map((row, index) => {
                    const serial = String(row.serial_no || row.hw_serial_no || '').trim();
                    const canClean = Boolean(serial);
                    return (
                      <TableRow key={remainingPcKey(row, index)} hover>
                        <TableCell>{row.inv_no || '—'}</TableCell>
                        <TableCell>{row.serial_no || row.hw_serial_no || '—'}</TableCell>
                        <TableCell>{row.model_name || '—'}</TableCell>
                        <TableCell>{row.location || '—'}</TableCell>
                        <TableCell>{row.employee || '—'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={row.last_cleaned_at ? 'warning' : 'error'}
                            label={formatLastCleanedAt(row.last_cleaned_at)}
                          />
                        </TableCell>
                        {canWrite ? (
                          <TableCell align="right">
                            <Tooltip title={canClean ? 'Поставить чистку' : 'Нет серийного номера'}>
                              <span>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<CleaningServicesIcon fontSize="small" />}
                                  disabled={submitting || !canClean}
                                  onClick={() => setConfirmRow(row)}
                                  aria-label={`Поставить чистку ${row.inv_no || serial}`}
                                >
                                  Чистка
                                </Button>
                              </span>
                            </Tooltip>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ pb: isMobile ? 'calc(env(safe-area-inset-bottom) + 8px)' : undefined }}>
          <Button onClick={onClose}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(confirmRow)}
        onClose={() => { if (!submitting) setConfirmRow(null); }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Поставить чистку?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Зарегистрировать чистку ПК {confirmLabel}
            {confirmRow?.model_name ? ` (${confirmRow.model_name})` : ''}?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRow(null)} disabled={submitting}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleConfirmCleaning}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CleaningServicesIcon />}
          >
            {submitting ? 'Сохранение...' : 'Поставить'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default PcRemainingDialog;
