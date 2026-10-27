import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_SECTION_MAX,
  FEEDBACK_STATUS_META,
  FEEDBACK_TITLE_MAX,
  feedbackAPI,
  formatFeedbackDateTime,
  getFeedbackErrorMessage,
  validateFeedbackDraft,
} from '../../api/feedback';
import FeedbackStatusChip from './FeedbackStatusChip';

const EMPTY_DRAFT = { category: 'idea', title: '', message: '', section: '' };
const FORM_ID = 'feedback-suggestion-form';

function fallbackSubmitMessage(status) {
  if (status === 429) return 'Достигнут дневной лимит предложений. Попробуйте завтра.';
  if (status === 503) return 'Раздел предложений пока не подключён. Попробуйте позже.';
  return 'Не удалось отправить предложение. Попробуйте позже.';
}

function SuggestionForm({ draft, errors, submitting, onFieldChange, onSubmit }) {
  return (
    <Box component="form" id={FORM_ID} onSubmit={onSubmit} noValidate>
      <Stack spacing={1.5}>
        <TextField
          select
          label="Категория"
          value={draft.category}
          onChange={onFieldChange('category')}
          error={Boolean(errors.category)}
          helperText={errors.category || ' '}
          disabled={submitting}
          fullWidth
        >
          {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </TextField>
        <TextField
          label="Заголовок"
          value={draft.title}
          onChange={onFieldChange('title')}
          error={Boolean(errors.title)}
          helperText={errors.title || `${draft.title.length}/${FEEDBACK_TITLE_MAX}`}
          inputProps={{ maxLength: FEEDBACK_TITLE_MAX }}
          disabled={submitting}
          required
          fullWidth
        />
        <TextField
          label="Описание"
          value={draft.message}
          onChange={onFieldChange('message')}
          error={Boolean(errors.message)}
          helperText={errors.message || `${draft.message.length}/${FEEDBACK_MESSAGE_MAX}`}
          inputProps={{ maxLength: FEEDBACK_MESSAGE_MAX }}
          disabled={submitting}
          required
          multiline
          minRows={4}
          fullWidth
        />
        <TextField
          label="Раздел портала (необязательно)"
          placeholder="Например: Задачи, Почта, Чат"
          value={draft.section}
          onChange={onFieldChange('section')}
          error={Boolean(errors.section)}
          helperText={errors.section || `До ${FEEDBACK_SECTION_MAX} символов`}
          inputProps={{ maxLength: FEEDBACK_SECTION_MAX }}
          disabled={submitting}
          fullWidth
        />
      </Stack>
    </Box>
  );
}

function SuggestionCard({ item }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: '12px' }} data-testid="feedback-mine-item">
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Typography sx={{ fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{item.title}</Typography>
          <FeedbackStatusChip status={item.status} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {[
            FEEDBACK_CATEGORY_LABELS[item.category] || item.category,
            item.section,
            formatFeedbackDateTime(item.created_at),
          ].filter(Boolean).join(' · ')}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {item.message}
        </Typography>
        {item.admin_note ? (
          <Box sx={{ borderLeft: '3px solid', borderColor: 'primary.main', pl: 1.25, py: 0.25 }}>
            <Typography variant="caption" color="text.secondary">Комментарий администрации</Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {item.admin_note}
            </Typography>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}

export function FeedbackDialog({ open, onClose }) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const [mode, setMode] = useState('new');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [successItem, setSuccessItem] = useState(null);
  const submittingRef = useRef(false);
  const [mine, setMine] = useState({ items: [], total: 0 });
  const [mineStatus, setMineStatus] = useState('idle');
  const [mineError, setMineError] = useState('');
  const mineRequestRef = useRef(0);

  const loadMine = useCallback(async () => {
    const requestId = mineRequestRef.current + 1;
    mineRequestRef.current = requestId;
    setMineStatus('loading');
    setMineError('');
    try {
      const data = await feedbackAPI.listMine({ limit: 50 });
      if (requestId !== mineRequestRef.current) return;
      setMine({ items: Array.isArray(data?.items) ? data.items : [], total: Number(data?.total) || 0 });
      setMineStatus('ready');
    } catch (error) {
      if (requestId !== mineRequestRef.current) return;
      setMineError(getFeedbackErrorMessage(error, 'Не удалось загрузить предложения.'));
      setMineStatus('error');
    }
  }, []);

  // Список «Мои предложения» грузится при показе вкладки в каждом открытии диалога.
  useEffect(() => {
    if (!open) {
      mineRequestRef.current += 1;
      setMineStatus('idle');
      return;
    }
    if (mode === 'mine' && mineStatus === 'idle') void loadMine();
  }, [open, mode, mineStatus, loadMine]);

  const handleFieldChange = (field) => (event) => {
    const { value } = event.target;
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setSubmitError(null);
    setSuccessItem(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const nextErrors = validateFeedbackDraft(draft);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const item = await feedbackAPI.createSuggestion({
        category: draft.category,
        title: draft.title.trim(),
        message: draft.message.trim(),
        section: draft.section.trim(),
      });
      setDraft(EMPTY_DRAFT);
      setSuccessItem(item || null);
      // Список уже загружен: добавляем новое предложение в начало без повторного запроса.
      if (item?.id && mineStatus === 'ready') {
        setMine((prev) => ({
          items: [item, ...prev.items.filter((existing) => existing.id !== item.id)],
          total: prev.total + 1,
        }));
      }
    } catch (error) {
      const status = error?.response?.status;
      setSubmitError({
        severity: status === 429 ? 'warning' : 'error',
        text: getFeedbackErrorMessage(error, fallbackSubmitMessage(status)),
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleModeChange = (_event, value) => {
    setMode(value);
    setSubmitError(null);
    setSuccessItem(null);
  };

  const handleClose = () => {
    if (!submittingRef.current) onClose?.();
  };

  let body = null;
  if (mode === 'new') {
    body = (
      <Stack spacing={1.5}>
        {successItem ? (
          <Alert
            severity="success"
            data-testid="feedback-success"
            action={(
              <Button color="inherit" size="small" onClick={() => handleModeChange(null, 'mine')}>
                Мои предложения
              </Button>
            )}
          >
            Спасибо! Предложение отправлено, статус: «{FEEDBACK_STATUS_META[successItem.status]?.label || successItem.status}».
          </Alert>
        ) : null}
        {submitError ? <Alert severity={submitError.severity}>{submitError.text}</Alert> : null}
        <SuggestionForm
          draft={draft}
          errors={errors}
          submitting={submitting}
          onFieldChange={handleFieldChange}
          onSubmit={handleSubmit}
        />
      </Stack>
    );
  } else if (mineStatus === 'loading' || mineStatus === 'idle') {
    body = (
      <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }} data-testid="feedback-mine-loading">
        <CircularProgress size={28} />
      </Box>
    );
  } else if (mineStatus === 'error') {
    body = (
      <Alert
        severity="error"
        action={<Button color="inherit" size="small" onClick={() => void loadMine()}>Повторить</Button>}
      >
        {mineError}
      </Alert>
    );
  } else if (mine.items.length === 0) {
    body = (
      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }} data-testid="feedback-mine-empty">
        Вы пока не отправляли предложений.
      </Typography>
    );
  } else {
    body = (
      <Stack spacing={1.25} data-testid="feedback-mine-list">
        {mine.items.map((item) => <SuggestionCard key={item.id} item={item} />)}
        {mine.total > mine.items.length ? (
          <Typography variant="caption" color="text.secondary">
            Показаны последние {mine.items.length} из {mine.total}.
          </Typography>
        ) : null}
      </Stack>
    );
  }

  return (
    <Dialog
      open={Boolean(open)}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isPhone}
      aria-labelledby="feedback-dialog-title"
    >
      <DialogTitle id="feedback-dialog-title" sx={{ pb: 1 }}>Что улучшить в Hub?</DialogTitle>
      <Tabs
        value={mode}
        onChange={handleModeChange}
        variant="fullWidth"
        sx={{ px: 2, borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
      >
        <Tab value="new" label="Новая идея" sx={{ minHeight: 44 }} />
        <Tab value="mine" label="Мои предложения" sx={{ minHeight: 44 }} />
      </Tabs>
      <DialogContent dividers>
        {mode === 'mine' && mineStatus === 'ready' ? (
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary">Всего: {mine.total}</Typography>
            <IconButton aria-label="Обновить список" onClick={() => void loadMine()} sx={{ width: 44, height: 44 }}>
              <RefreshRoundedIcon />
            </IconButton>
          </Stack>
        ) : null}
        {body}
      </DialogContent>
      {mode === 'new' ? (
        <DialogActions sx={{ px: 2, py: 1.2 }}>
          <Button onClick={handleClose} disabled={submitting} sx={{ minHeight: 44 }}>Закрыть</Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="contained"
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ minHeight: 44 }}
          >
            Отправить
          </Button>
        </DialogActions>
      ) : (
        <DialogActions sx={{ px: 2, py: 1.2 }}>
          <Button onClick={handleClose} sx={{ minHeight: 44 }}>Закрыть</Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

export default FeedbackDialog;
