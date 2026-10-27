import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';

import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_META,
  FEEDBACK_STATUS_ORDER,
  feedbackAPI,
  formatFeedbackDateTime,
  getFeedbackErrorMessage,
} from '../../../api/feedback';
import FeedbackStatusChip from '../../../components/feedback/FeedbackStatusChip';

const PAGE_SIZE = 20;
const ADMIN_NOTE_MAX = 1000;

function mergeUnique(prev, next) {
  const seen = new Set(prev.map((item) => item.id));
  return [...prev, ...next.filter((item) => !seen.has(item.id))];
}

function FeedbackAdminCard({ item, onSave }) {
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState(item.admin_note || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const trimmedNote = note.trim();
  const changedStatus = status !== item.status;
  const changedNote = trimmedNote !== String(item.admin_note || '').trim();
  const hasChanges = changedStatus || changedNote;

  const handleSave = async () => {
    const patch = {};
    if (changedStatus) patch.status = status;
    if (changedNote) patch.admin_note = trimmedNote;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(item, patch);
    } catch (error) {
      setSaveError(getFeedbackErrorMessage(error, 'Не удалось сохранить изменения.'));
    } finally {
      setSaving(false);
    }
  };

  const authorName = item.author?.full_name || item.author?.username || '—';

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px' }} data-testid={`feedback-admin-item-${item.id}`}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Typography sx={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{item.title}</Typography>
          <FeedbackStatusChip status={item.status} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {[
            authorName,
            FEEDBACK_CATEGORY_LABELS[item.category] || item.category,
            item.section,
            formatFeedbackDateTime(item.created_at),
          ].filter(Boolean).join(' · ')}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {item.message}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
          <TextField
            select
            size="small"
            label="Статус"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            disabled={saving}
            sx={{ minWidth: { sm: 180 } }}
          >
            {FEEDBACK_STATUS_ORDER.map((value) => (
              <MenuItem key={value} value={value}>{FEEDBACK_STATUS_META[value].label}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Комментарий администрации"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={saving}
            inputProps={{ maxLength: ADMIN_NOTE_MAX }}
            helperText={`${note.length}/${ADMIN_NOTE_MAX}`}
            multiline
            minRows={1}
            fullWidth
          />
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={!hasChanges || saving}
            sx={{ minHeight: 40, flexShrink: 0 }}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </Stack>
        {saveError ? <Alert severity="error">{saveError}</Alert> : null}
      </Stack>
    </Paper>
  );
}

export function FeedbackAdminSection() {
  const [statusFilter, setStatusFilter] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const requestRef = useRef(0);

  const reload = useCallback(async (filter) => {
    requestRef.current += 1;
    const requestId = requestRef.current;
    setLoadState('loading');
    setLoadError('');
    setMoreError('');
    try {
      const data = await feedbackAPI.listAdmin({ status: filter, limit: PAGE_SIZE, offset: 0 });
      if (requestId !== requestRef.current) return;
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total) || 0);
      setCounts(data?.counts || {});
      setLoadState('ready');
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setLoadError(getFeedbackErrorMessage(error, 'Не удалось загрузить предложения.'));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void reload(statusFilter);
  }, [reload, statusFilter]);

  const loadMore = async () => {
    if (loadingMore) return;
    requestRef.current += 1;
    const requestId = requestRef.current;
    setLoadingMore(true);
    setMoreError('');
    try {
      const data = await feedbackAPI.listAdmin({ status: statusFilter, limit: PAGE_SIZE, offset: items.length });
      if (requestId !== requestRef.current) return;
      setItems((prev) => mergeUnique(prev, Array.isArray(data?.items) ? data.items : []));
      setTotal(Number(data?.total) || 0);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setMoreError(getFeedbackErrorMessage(error, 'Не удалось загрузить следующие предложения.'));
    } finally {
      if (requestId === requestRef.current) setLoadingMore(false);
    }
  };

  // Сохранение обновляет запись и счётчики локально, без перезагрузки всего списка.
  const handleSave = async (item, patch) => {
    const updated = await feedbackAPI.updateSuggestion(item.id, patch);
    const next = { ...item, ...(updated || {}), author: updated?.author || item.author };
    if (patch.status && patch.status !== item.status) {
      setCounts((prev) => ({
        ...prev,
        [item.status]: Math.max(0, (Number(prev[item.status]) || 0) - 1),
        [patch.status]: (Number(prev[patch.status]) || 0) + 1,
      }));
      if (statusFilter && patch.status !== statusFilter) {
        setItems((prev) => prev.filter((existing) => existing.id !== item.id));
        setTotal((prev) => Math.max(0, prev - 1));
        return next;
      }
    }
    setItems((prev) => prev.map((existing) => (existing.id === item.id ? next : existing)));
    return next;
  };

  const totalAll = FEEDBACK_STATUS_ORDER.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);

  return (
    <Stack spacing={1.5} data-testid="feedback-admin-section">
      <Box>
        <Typography variant="h6">Предложения по улучшению</Typography>
        <Typography variant="body2" color="text.secondary">
          Идеи и замечания пользователей по порталу. Статус и комментарий видит автор предложения.
        </Typography>
      </Box>

      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
        <Chip
          label={`Все (${totalAll})`}
          clickable
          aria-pressed={statusFilter === ''}
          color={statusFilter === '' ? 'primary' : 'default'}
          variant={statusFilter === '' ? 'filled' : 'outlined'}
          onClick={() => setStatusFilter('')}
          sx={{ minHeight: 36 }}
        />
        {FEEDBACK_STATUS_ORDER.map((key) => {
          const active = statusFilter === key;
          return (
            <Chip
              key={key}
              label={`${FEEDBACK_STATUS_META[key].label} (${Number(counts[key]) || 0})`}
              clickable
              aria-pressed={active}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              onClick={() => setStatusFilter(key)}
              sx={{ minHeight: 36 }}
            />
          );
        })}
        <IconButton aria-label="Обновить список" onClick={() => void reload(statusFilter)} sx={{ width: 44, height: 44 }}>
          <RefreshRoundedIcon />
        </IconButton>
      </Stack>

      {loadState === 'loading' ? (
        <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      ) : null}

      {loadState === 'error' ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void reload(statusFilter)}>Повторить</Button>}
        >
          {loadError}
        </Alert>
      ) : null}

      {loadState === 'ready' && items.length === 0 ? (
        <Alert severity="info">Предложений с таким статусом пока нет.</Alert>
      ) : null}

      {loadState === 'ready' ? items.map((item) => (
        <FeedbackAdminCard key={`${item.id}:${item.updated_at || ''}`} item={item} onSave={handleSave} />
      )) : null}

      {loadState === 'ready' && items.length < total ? (
        <Stack spacing={1} alignItems="center">
          {moreError ? <Alert severity="error" sx={{ width: '100%' }}>{moreError}</Alert> : null}
          <Button variant="outlined" onClick={() => void loadMore()} disabled={loadingMore} sx={{ minHeight: 44 }}>
            {loadingMore ? 'Загрузка…' : `Показать ещё (${total - items.length})`}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}

export default FeedbackAdminSection;
