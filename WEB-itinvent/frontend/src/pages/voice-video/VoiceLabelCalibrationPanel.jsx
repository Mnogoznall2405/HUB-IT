import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { voiceLabelingAPI } from '../../api/voiceLabeling';

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

export function envSnippet(suggested) {
  if (!suggested) return '';
  return [
    `SPEAKER_ID_STRICT=${suggested.strict}`,
    `SPEAKER_ID_MODERATE=${suggested.moderate}`,
    `SPEAKER_ID_LOOSE=${suggested.loose}`,
  ].join('\n');
}

function Suggestion({ title, suggestion, projects }) {
  if (!suggestion) return null;
  const s = suggestion.suggested;
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{title}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {projects !== undefined ? `Разметок: ${projects}. ` : ''}
        Свой голос: от {pct(suggestion.min_positive)} · чужие: до {pct(suggestion.max_negative)}
        {' '}({suggestion.positives} своих / {suggestion.negatives} чужих пар)
      </Typography>
      {suggestion.note && (
        <Alert severity={suggestion.separable === false ? 'warning' : 'info'} sx={{ mt: 0.5 }}>
          {suggestion.note}
        </Alert>
      )}
      {s && (
        <>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
            Рекомендация для <code>voice_video/.env</code> (сейчас {suggestion.current?.strict} / {suggestion.current?.moderate} / {suggestion.current?.loose}):
          </Typography>
          <Box
            component="pre"
            data-testid="calibration-env"
            sx={{ m: 0, mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'action.hover', fontSize: 12, whiteSpace: 'pre-wrap' }}
          >
            {envSnippet(s)}
          </Box>
        </>
      )}
    </Box>
  );
}

// Similarity of labeled employees' voices with the reference voices -> identification thresholds.
function VoiceLabelCalibrationPanel({ projectId, auxJob, dirty, hasNamedSpeakers, onProjectUpdate }) {
  const [data, setData] = useState(null);
  const [overall, setOverall] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const calibrateJob = auxJob?.action === 'calibrate' ? auxJob : null;
  const running = calibrateJob && ['queued', 'processing'].includes(calibrateJob.status);
  const anyAuxActive = auxJob && ['queued', 'processing'].includes(auxJob.status);

  const load = useCallback(async () => {
    try {
      const [own, all] = await Promise.all([
        voiceLabelingAPI.getCalibration(projectId),
        voiceLabelingAPI.getOverallCalibration(),
      ]);
      setData(own);
      setOverall(all);
    } catch (err) {
      setError(extractDetail(err, 'Не удалось загрузить подбор порога'));
    }
  }, [projectId]);

  const jobKey = calibrateJob ? `${calibrateJob.id}:${calibrateJob.status}` : '';
  useEffect(() => { load(); }, [load, jobKey]);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      onProjectUpdate(await voiceLabelingAPI.calibrate(projectId));
    } catch (err) {
      setError(extractDetail(err, 'Не удалось поставить в очередь'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2">Подбор порога узнавания</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Насколько голоса размеченных сотрудников похожи на их эталоны и на чужие. Берите встречи,
        из которых эталоны <b>не</b> записывались — иначе своя похожесть будет завышена.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      <Button
        variant="outlined"
        size="small"
        onClick={run}
        disabled={busy || dirty || !hasNamedSpeakers || anyAuxActive}
      >
        Посчитать похожесть с эталонами
      </Button>
      {dirty && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Сначала сохраните разметку.</Typography>}
      {running && <LinearProgress sx={{ mt: 1 }} />}
      {calibrateJob?.status === 'failed' && (
        <Alert severity="error" sx={{ mt: 1 }}>Не посчитано: {calibrateJob.error || 'ошибка'}</Alert>
      )}
      {data?.available && (
        <Box sx={{ overflowX: 'auto', mt: 1 }}>
          <Table size="small" aria-label="Похожесть с эталонами">
            <TableHead>
              <TableRow>
                <TableCell>Сотрудник</TableCell>
                <TableCell align="right">Со своим</TableCell>
                <TableCell>Ближайший чужой</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell align="right">{r.own_similarity === null ? 'нет эталона' : pct(r.own_similarity)}</TableCell>
                  <TableCell>{r.best_other ? `${r.best_other} · ${pct(r.best_other_similarity)}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      <Stack>
        {data?.available && <Suggestion title="По этой встрече" suggestion={data.suggestion} />}
        {overall?.projects > 0 && (
          <Suggestion title="По всем разметкам" suggestion={overall.suggestion} projects={overall.projects} />
        )}
      </Stack>
    </Paper>
  );
}

export default VoiceLabelCalibrationPanel;
