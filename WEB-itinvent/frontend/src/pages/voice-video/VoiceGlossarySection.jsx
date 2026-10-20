import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { voiceGlossaryAPI } from '../../api/voiceGlossary';

const KINDS = {
  abbr: 'Аббревиатура',
  object: 'Объект',
  org: 'Организация',
  doc: 'Документ',
  person: 'Человек',
  other: 'Другое',
};

const FILTERS = [
  { key: 'candidate', label: 'Кандидаты' },
  { key: 'confirmed', label: 'Подтверждённые' },
  { key: 'rejected', label: 'Отклонённые' },
];

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

const splitAliases = (text) => String(text || '')
  .split(/[,;\n]/)
  .map((item) => item.trim())
  .filter(Boolean);

function TermDialog({ term, onClose, onSaved }) {
  const isNew = !term?.id;
  const [form, setForm] = useState({
    term: term?.term || '',
    kind: term?.kind || 'other',
    expansion: term?.expansion || '',
    aliases: (term?.aliases || []).join(', '),
    core: Boolean(term?.core),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError('');
    const payload = {
      term: form.term.trim(),
      kind: form.kind,
      expansion: form.expansion.trim(),
      aliases: splitAliases(form.aliases),
      core: form.core,
    };
    try {
      // правка кандидата во вкладке — это и подтверждение: человек посмотрел и поправил
      const saved = isNew
        ? await voiceGlossaryAPI.create({ ...payload, status: 'confirmed' })
        : await voiceGlossaryAPI.update(term.id, { ...payload, status: 'confirmed' });
      onSaved(saved);
    } catch (err) {
      setError(extractDetail(err, 'Не удалось сохранить термин'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'Новый термин' : 'Термин словаря'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Термин"
            value={form.term}
            onChange={(e) => set('term', e.target.value)}
            helperText="Как должно писаться в протоколе: ГПР, УМТО, Морстрой"
            autoFocus
            fullWidth
          />
          <TextField select label="Тип" value={form.kind} onChange={(e) => set('kind', e.target.value)} fullWidth>
            {Object.entries(KINDS).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          <TextField
            label="Расшифровка"
            value={form.expansion}
            onChange={(e) => set('expansion', e.target.value)}
            helperText="Для аббревиатур и документов. Без расшифровки термин попадёт в промпт только как верное написание"
            multiline
            minRows={2}
            fullWidth
          />
          <TextField
            label="Неверные написания"
            value={form.aliases}
            onChange={(e) => set('aliases', e.target.value)}
            helperText="Через запятую: как это слово ошибочно распознаётся («Унто, ОНТУ»). Они будут заменяться на термин"
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={form.core} onChange={(e) => set('core', e.target.checked)} />}
            label="Общий термин компании (всегда подставлять в промпт)"
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Отмена</Button>
        <Button variant="contained" onClick={save} disabled={busy || form.term.trim().length < 2}>
          {isNew ? 'Добавить' : 'Сохранить и подтвердить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function VoiceGlossarySection() {
  const [filter, setFilter] = useState('candidate');
  const [query, setQuery] = useState('');
  const [data, setData] = useState({ items: [], counts: { candidate: 0, confirmed: 0, rejected: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // term | {} для нового
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    try {
      const result = await voiceGlossaryAPI.list({ status: filter, q: query.trim() || undefined });
      if (requestRef.current !== requestId) return; // ответ устаревшего запроса не перетирает свежий
      setData(result);
      setError('');
    } catch (err) {
      if (requestRef.current === requestId) setError(extractDetail(err, 'Не удалось загрузить словарь'));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const act = async (fn, fallback) => {
    try {
      await fn();
      setError('');
      await load();
    } catch (err) {
      setError(extractDetail(err, fallback));
    }
  };

  const setStatus = (term, status) => act(
    () => voiceGlossaryAPI.update(term.id, { status }), 'Не удалось изменить статус',
  );
  const remove = (term) => {
    if (!window.confirm(`Удалить «${term.term}» из словаря?`)) return;
    act(() => voiceGlossaryAPI.remove(term.id), 'Не удалось удалить термин');
  };

  return (
    <Stack spacing={2} data-testid="voice-glossary">
      <Alert severity="info" sx={{ py: 0.5 }}>
        Словарь компании: после каждой записи нейросеть предлагает аббревиатуры, объекты и подрядчиков.
        Подтверждённые термины подставляются в анализ только если звучат в записи, и исправляют типичные ошибки распознавания.
      </Alert>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {FILTERS.map(({ key, label }) => (
            <Chip
              key={key}
              label={`${label} (${data.counts?.[key] ?? 0})`}
              color={filter === key ? 'primary' : 'default'}
              variant={filter === key ? 'filled' : 'outlined'}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder="Поиск"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputProps={{ 'aria-label': 'Поиск по словарю' }}
          />
          <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => setEditing({})}>
            Термин
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {loading && !data.items.length ? (
        <Stack spacing={1}>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      ) : null}

      {!loading && !data.items.length && !error && (
        <Alert severity="info">
          {filter === 'candidate'
            ? 'Кандидатов нет. Они появятся после обработки следующей записи.'
            : 'В этом списке пока пусто.'}
        </Alert>
      )}

      <Stack spacing={1}>
        {data.items.map((term) => (
          <Paper key={term.id} variant="outlined" sx={{ p: 1.25 }} data-term={term.term}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{term.term}</Typography>
                  <Chip size="small" variant="outlined" label={KINDS[term.kind] || KINDS.other} />
                  {term.core && <Chip size="small" color="primary" variant="outlined" label="общий" />}
                  {term.status === 'candidate' && term.occurrences > 1 && (
                    <Chip size="small" label={`в ${term.occurrences} записях`} />
                  )}
                </Stack>
                <Typography variant="body2" color={term.expansion ? 'text.primary' : 'text.secondary'}>
                  {term.expansion || (term.kind === 'abbr' ? 'Расшифровка не указана' : '')}
                </Typography>
                {term.aliases?.length > 0 && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    Ошибочно распознаётся: {term.aliases.join(', ')}
                  </Typography>
                )}
                {term.status === 'candidate' && term.evidence && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ fontStyle: 'italic' }}>
                    {term.evidence}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                {term.status !== 'confirmed' && (
                  <Tooltip title="Подтвердить">
                    <IconButton size="small" color="success" aria-label={`Подтвердить ${term.term}`} onClick={() => setStatus(term, 'confirmed')}>
                      <CheckOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {term.status !== 'rejected' && (
                  <Tooltip title="Отклонить">
                    <IconButton size="small" aria-label={`Отклонить ${term.term}`} onClick={() => setStatus(term, 'rejected')}>
                      <CloseOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Изменить">
                  <IconButton size="small" aria-label={`Изменить ${term.term}`} onClick={() => setEditing(term)}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Удалить">
                  <IconButton size="small" aria-label={`Удалить ${term.term}`} onClick={() => remove(term)}>
                    <DeleteOutlineOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>

      {editing && (
        <TermDialog
          term={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </Stack>
  );
}

export default VoiceGlossarySection;
