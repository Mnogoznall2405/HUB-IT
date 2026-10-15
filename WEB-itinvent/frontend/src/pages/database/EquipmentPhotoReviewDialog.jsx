import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import ThumbDownOffAltIcon from '@mui/icons-material/ThumbDownOffAlt';
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';

import { LoadingSpinner } from '../../components/common';
import { equipmentPhotoReviewAPI } from '../../api/equipmentPhotoReview';
import { equipmentPhotosAPI } from '../../api/equipmentPhotos';
import { MAX_REJECT_REASON, rememberRejectReason } from './photoRejectReasons';
import RejectReasonChips from './RejectReasonChips';

const PAGE_SIZE = 30;
const LIST_ERROR = 'Не удалось загрузить очередь проверки фото.';
const ACTION_ERROR = 'Не удалось изменить отметку проверки.';

const STATUS_REJECTED = 'rejected';
const STATUS_UNCHECKED = 'unchecked';

const readError = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' ? detail : (error?.message || fallback);
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

const rowKey = (row) => `${row.item_id}:${row.file_no}`;

const ReviewThumb = memo(function ReviewThumb({ itemId, fileNo, dbId }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setFailed(false);
    equipmentPhotosAPI
      .fetchContent(itemId, fileNo, { thumb: true, params: dbId ? { db_id: dbId } : {} })
      .then((response) => {
        const blob = response?.data instanceof Blob ? response.data : null;
        if (!blob || cancelled) return;
        objectUrl = window.URL?.createObjectURL?.(blob) || '';
        if (objectUrl) setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) window.URL?.revokeObjectURL?.(objectUrl);
    };
  }, [itemId, fileNo, dbId]);

  return (
    <Box
      sx={{
        width: 84,
        height: 84,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'action.hover',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <Box component="img" src={url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <ImageOutlinedIcon color={failed ? 'error' : 'disabled'} />
      )}
    </Box>
  );
});

// Очередь проверки фото: «Отклонённые» (ждут исправления) и «Не проверено» (ждут решения).
export default function EquipmentPhotoReviewDialog({
  open,
  onClose,
  onOpenEquipment,
  onChanged,
  dbId = '',
  initialStatus = STATUS_REJECTED,
  // Меняется, когда пользователь вернулся из карточки: список перечитывается на месте.
  reloadToken = 0,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [status, setStatus] = useState(initialStatus);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState({ reject_supported: true, scan_capped: false, since_days: 30 });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [rejectCandidate, setRejectCandidate] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    if (open) setStatus(initialStatus);
  }, [open, initialStatus]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async ({ append = false, offset = 0 } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const data = await equipmentPhotoReviewAPI.list({
        status, q: debouncedQuery, offset, limit: PAGE_SIZE, dbId,
      });
      if (requestRef.current !== requestId) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      setRows((prev) => (append ? [...prev, ...items] : items));
      setTotal(Number(data?.total) || 0);
      setMeta({
        reject_supported: data?.reject_supported !== false,
        scan_capped: Boolean(data?.scan_capped),
        since_days: Number(data?.since_days) || 30,
      });
    } catch (err) {
      if (requestRef.current === requestId) setError(readError(err, LIST_ERROR));
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [dbId, debouncedQuery, status]);

  useEffect(() => {
    if (!open) return undefined;
    setRows([]);
    setTotal(0);
    void load();
    return () => { requestRef.current += 1; };
  }, [open, load]);

  const reloadSeenRef = useRef(reloadToken);
  useEffect(() => {
    if (reloadSeenRef.current === reloadToken) return;
    reloadSeenRef.current = reloadToken;
    if (open) void load();
  }, [reloadToken, open, load]);

  const dropRow = (row) => {
    setRows((prev) => prev.filter((item) => rowKey(item) !== rowKey(row)));
    setTotal((prev) => Math.max(0, prev - 1));
  };

  const runAction = async (row, action, reason = '') => {
    if (busyKey) return false;
    const key = rowKey(row);
    setBusyKey(key);
    setError('');
    const params = dbId ? { db_id: dbId } : {};
    try {
      if (action === 'verify') await equipmentPhotosAPI.verify(row.item_id, row.file_no, params);
      else await equipmentPhotosAPI.reject(row.item_id, row.file_no, reason, params);
      // Решённое фото уходит из очереди; «Отклонённые» после повторного решения — тоже.
      dropRow(row);
      onChanged?.();
      return true;
    } catch (err) {
      setError(readError(err, ACTION_ERROR));
      return false;
    } finally {
      setBusyKey('');
    }
  };

  const handleConfirmReject = async () => {
    const row = rejectCandidate;
    const reason = rejectReason.trim();
    if (!row || !reason) return;
    const ok = await runAction(row, 'reject', reason);
    if (ok) {
      rememberRejectReason(reason);
      setRejectCandidate(null);
      setRejectReason('');
    }
  };

  const canLoadMore = rows.length < total;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        fullScreen={fullScreen}
        data-testid="equipment-photo-review-dialog"
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
          <Box sx={{ flex: 1 }}>Проверка фото</Box>
          <IconButton aria-label="Закрыть" onClick={onClose}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Tabs
            value={status}
            onChange={(_event, next) => setStatus(next)}
            variant="fullWidth"
            sx={{ mb: 1.5 }}
          >
            <Tab value={STATUS_REJECTED} label="Отклонённые" />
            <Tab value={STATUS_UNCHECKED} label="Не проверено" />
          </Tabs>
          <TextField
            fullWidth
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Инв. номер, модель, сотрудник, серийный"
            sx={{ mb: 1.5 }}
          />
          {!meta.reject_supported ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              Отметки отказа ещё недоступны в этой базе — очередь «Отклонённые» пуста.
            </Alert>
          ) : null}
          {status === STATUS_UNCHECKED ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {`Фото за последние ${meta.since_days} дн., без отметки проверки; свои фото не показываются.`}
              {meta.scan_capped ? ' Просмотрена только часть недавних загрузок.' : ''}
            </Typography>
          ) : null}
          {error ? <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert> : null}
          {loading ? <LoadingSpinner /> : null}
          {!loading && !rows.length && !error ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              {status === STATUS_REJECTED ? 'Отклонённых фото нет.' : 'Непроверенных фото нет.'}
            </Typography>
          ) : null}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rows.map((row) => {
              const key = rowKey(row);
              const busy = busyKey === key;
              return (
                <Paper key={key} variant="outlined" sx={{ p: 1, display: 'flex', gap: 1.25 }} data-testid="photo-review-row">
                  <ReviewThumb itemId={row.item_id} fileNo={row.file_no} dbId={dbId} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle2" noWrap title={row.model_name}>
                      {`${row.inv_no || row.item_id} · ${row.model_name || 'Без модели'}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                      {[row.employee_name, row.branch_name, row.location_name].filter(Boolean).join(' · ') || '—'}
                    </Typography>
                    {row.serial_no ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                        {`S/N ${row.serial_no}`}
                      </Typography>
                    ) : null}
                    {row.status === STATUS_REJECTED ? (
                      <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                        {`Отклонено: ${row.reject_reason || 'без причины'}`}
                        {row.rejected_by ? ` · ${row.rejected_by}` : ''}
                        {row.rejected_at ? ` · ${formatDate(row.rejected_at)}` : ''}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {`Загрузил${row.uploaded_by_name || row.created_by ? `: ${row.uploaded_by_name || row.created_by}` : ''}`}
                        {row.created_at ? ` · ${formatDate(row.created_at)}` : ''}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
                      <Button size="small" onClick={() => onOpenEquipment?.(row.inv_no || row.item_id)}>
                        Открыть карточку
                      </Button>
                      {row.status !== STATUS_REJECTED && !row.is_own ? (
                        <>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            disableElevation
                            startIcon={<VerifiedOutlinedIcon />}
                            disabled={Boolean(busyKey)}
                            onClick={() => { void runAction(row, 'verify'); }}
                          >
                            {busy ? '...' : 'Проверено'}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<ThumbDownOffAltIcon />}
                            disabled={Boolean(busyKey)}
                            onClick={() => { setRejectReason(''); setRejectCandidate(row); }}
                          >
                            Отклонить
                          </Button>
                        </>
                      ) : null}
                    </Box>
                  </Box>
                </Paper>
              );
            })}
          </Box>
          {canLoadMore && !loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
              <Button
                onClick={() => { void load({ append: true, offset: rows.length }); }}
                disabled={loadingMore}
              >
                {loadingMore ? 'Загрузка...' : `Показать ещё (${total - rows.length})`}
              </Button>
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(rejectCandidate)}
        onClose={() => (busyKey ? undefined : setRejectCandidate(null))}
        maxWidth="xs"
        fullWidth
        sx={{ zIndex: (t) => `${t.zIndex.modal + 5} !important` }}
      >
        <DialogTitle>Отклонить фото?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Напишите, почему фото не принято — это увидит загрузивший и сможет исправить.
          </Typography>
          <RejectReasonChips value={rejectReason} onChange={setRejectReason} disabled={Boolean(busyKey)} />
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            label="Причина отказа"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value.slice(0, MAX_REJECT_REASON))}
            helperText={`${rejectReason.length}/${MAX_REJECT_REASON}`}
            inputProps={{ maxLength: MAX_REJECT_REASON }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectCandidate(null)} disabled={Boolean(busyKey)}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            disabled={!rejectReason.trim() || Boolean(busyKey)}
            onClick={() => { void handleConfirmReject(); }}
          >
            Отклонить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
