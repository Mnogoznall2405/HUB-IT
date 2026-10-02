import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { voiceLabelingAPI } from '../../api/voiceLabeling';

const SEPARATORS = [
  ['kim', 'Kim Vocal 2'],
  ['melband', 'MelBand Roformer'],
  ['viperx', 'BS-Roformer Viperx'],
  ['demucs', 'Demucs'],
];

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

// DER of the model draft and extra variants against the human-corrected labeling.
function VoiceLabelQualityPanel({ projectId, auxJob, variants, dirty, savedVersion, onProjectUpdate }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [separator, setSeparator] = useState('kim');
  const [busy, setBusy] = useState(false);
  const variantJobActive = auxJob?.action === 'variant' && ['queued', 'processing'].includes(auxJob.status);
  const anyAuxActive = auxJob && ['queued', 'processing'].includes(auxJob.status);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMetrics(await voiceLabelingAPI.getMetrics(projectId));
    } catch (err) {
      setError(extractDetail(err, 'Не удалось посчитать метрики'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Recount after each save and when a variant finishes.
  const variantsKey = (variants || []).map((v) => `${v.name}:${v.created_at}`).join('|');
  useEffect(() => { load(); }, [load, savedVersion, variantsKey]);

  const runVariant = async () => {
    setBusy(true);
    setError('');
    try {
      onProjectUpdate(await voiceLabelingAPI.createVariant(projectId, separator));
    } catch (err) {
      setError(extractDetail(err, 'Не удалось поставить в очередь'));
    } finally {
      setBusy(false);
    }
  };

  const removeVariant = async (name) => {
    setError('');
    try {
      onProjectUpdate(await voiceLabelingAPI.deleteVariant(projectId, name));
    } catch (err) {
      setError(extractDetail(err, 'Не удалось удалить вариант'));
    }
  };

  const best = (metrics?.items || [])
    .filter((m) => m.der !== null && m.der !== undefined)
    .reduce((acc, m) => (acc === null || m.der < acc.der ? m : acc), null);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Качество диаризации</Typography>
        <Tooltip title="Пересчитать">
          <span>
            <IconButton size="small" aria-label="Пересчитать метрики" onClick={load} disabled={loading}>
              <RefreshOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        DER — доля времени речи с ошибкой: пропуск, лишняя речь или не тот спикер. Меньше — лучше.
        Эталон — ваша сохранённая разметка, допуск ±0,25 с у границ.
      </Typography>
      {metrics && !metrics.edited && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Разметка ещё не исправлена — пока эталон совпадает с черновиком модели.
        </Alert>
      )}
      {dirty && <Alert severity="warning" sx={{ mb: 1 }}>Сохраните правки — метрики считаются по сохранённой версии.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      {loading && !metrics && <LinearProgress />}
      {metrics && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Метрики диаризации">
            <TableHead>
              <TableRow>
                <TableCell>Вариант</TableCell>
                <TableCell align="right">DER</TableCell>
                <TableCell align="right">Пропуск</TableCell>
                <TableCell align="right">Лишнее</TableCell>
                <TableCell align="right">Путаница</TableCell>
                <TableCell align="right">Спикеров</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {metrics.items.map((m) => (
                <TableRow key={m.name} selected={best?.name === m.name && metrics.items.length > 1}>
                  <TableCell>
                    {m.title}
                    {best?.name === m.name && metrics.items.length > 1 && (
                      <Chip size="small" color="success" label="лучше" sx={{ ml: 0.5, height: 18 }} />
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>{pct(m.der)}</TableCell>
                  <TableCell align="right">{pct(m.miss)}</TableCell>
                  <TableCell align="right">{pct(m.false_alarm)}</TableCell>
                  <TableCell align="right">{pct(m.confusion)}</TableCell>
                  <TableCell align="right">{m.hypothesis_speakers} / {m.reference_speakers}</TableCell>
                  <TableCell padding="none">
                    {m.name !== 'auto' && (
                      <IconButton size="small" aria-label={`Удалить вариант ${m.title}`} onClick={() => removeVariant(m.name)}>
                        <DeleteOutlineOutlinedIcon fontSize="inherit" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <TextField
          select
          size="small"
          label="Сепаратор"
          value={separator}
          onChange={(e) => setSeparator(e.target.value)}
          sx={{ minWidth: 170 }}
        >
          {SEPARATORS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
        </TextField>
        <Button variant="outlined" onClick={runVariant} disabled={busy || anyAuxActive}>
          Прогнать на очищенном звуке
        </Button>
      </Stack>
      {variantJobActive && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">Диаризация варианта в очереди / выполняется…</Typography>
          <LinearProgress variant={auxJob.progress ? 'determinate' : 'indeterminate'} value={auxJob.progress || 0} />
        </Box>
      )}
      {auxJob?.action === 'variant' && auxJob.status === 'failed' && (
        <Alert severity="error" sx={{ mt: 1 }}>Вариант не построен: {auxJob.error || 'ошибка'}</Alert>
      )}
    </Paper>
  );
}

export default VoiceLabelQualityPanel;
