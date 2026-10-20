import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { voiceLabelingAPI } from '../../api/voiceLabeling';
import { formatDuration } from './labelingModel';

const FACE_ACTIONS = ['faces_scan', 'faces_enroll'];

const extractDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

// Подписи, готовые к отправке: только заполненные кластеры (имя или «не человек»).
export function buildAssign(draft) {
  const out = {};
  Object.entries(draft).forEach(([id, choice]) => {
    const name = (choice.name || '').trim();
    if (name || choice.delete) {
      out[id] = { name, delete: Boolean(choice.delete), excluded: choice.excluded || [] };
    }
  });
  return out;
}

function ClusterCard({ projectId, cluster, choice, people, onChange }) {
  const excluded = choice.excluded || [];
  const toggleFace = (faceId) => {
    const next = excluded.includes(faceId) ? excluded.filter((id) => id !== faceId) : [...excluded, faceId];
    onChange({ excluded: next });
  };
  return (
    <Paper variant="outlined" sx={{ p: 1.25, opacity: choice.delete ? 0.55 : 1 }} data-testid={`face-cluster-${cluster.id}`}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {cluster.count} лиц, с {formatDuration(cluster.first_t)}. Клик по лицу — оно лишнее (чужое или не лицо).
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {cluster.shown.map((faceId) => (
          <Box
            key={faceId}
            component="img"
            src={voiceLabelingAPI.faceThumbUrl(projectId, faceId)}
            alt=""
            onClick={() => toggleFace(faceId)}
            sx={{
              width: 56,
              height: 56,
              objectFit: 'cover',
              borderRadius: 1,
              cursor: 'pointer',
              border: '3px solid',
              borderColor: excluded.includes(faceId) ? 'error.main' : 'transparent',
              opacity: excluded.includes(faceId) ? 0.3 : 1,
            }}
          />
        ))}
      </Box>
      {cluster.voices.length > 0 && (
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mb: 1, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Звучало в эти моменты:</Typography>
          {cluster.voices.map((voice) => (
            <Chip
              key={voice.label}
              size="small"
              variant="outlined"
              label={`${voice.name || voice.label} ${Math.round(voice.share * 100)}%`}
              onClick={voice.name ? () => onChange({ name: voice.name }) : undefined}
              title={voice.name ? 'Подставить это имя' : 'Голос ещё без имени'}
            />
          ))}
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
        <Autocomplete
          freeSolo
          size="small"
          sx={{ minWidth: 280, flex: 1 }}
          options={people}
          inputValue={choice.name || ''}
          onInputChange={(_, value) => onChange({ name: value })}
          disabled={choice.delete}
          renderInput={(params) => (
            <TextField {...params} label="ФИО полностью (пусто — пропустить)" inputProps={{ ...params.inputProps, 'aria-label': `ФИО кластера ${cluster.id + 1}` }} />
          )}
        />
        <FormControlLabel
          control={<Checkbox size="small" checked={Boolean(choice.delete)} onChange={(e) => onChange({ delete: e.target.checked })} />}
          label="Не человек"
        />
      </Stack>
    </Paper>
  );
}

// Лица записи -> человек подписывает ФИО -> эталоны лиц (биометрия: превью после записи удаляются).
function VoiceLabelFacesPanel({ projectId, auxJob, onProjectUpdate }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [purge, setPurge] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const faceJob = FACE_ACTIONS.includes(auxJob?.action) ? auxJob : null;
  const running = faceJob && ['queued', 'processing'].includes(faceJob.status);
  const anyAuxActive = auxJob && ['queued', 'processing'].includes(auxJob.status);

  const load = useCallback(async () => {
    try {
      setData(await voiceLabelingAPI.getFaces(projectId));
    } catch (err) {
      setError(extractDetail(err, 'Не удалось загрузить лица'));
    }
  }, [projectId]);
  const jobKey = faceJob ? `${faceJob.id}:${faceJob.status}` : '';
  useEffect(() => { load(); }, [load, jobKey]);
  useEffect(() => { setDraft({}); }, [data?.faces_total]);

  const assign = useMemo(() => buildAssign(draft), [draft]);
  const named = Object.values(assign).filter((choice) => choice.name && !choice.delete).length;
  const change = (id, patch) => setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const call = async (action, fallback) => {
    setBusy(true);
    setError('');
    try {
      return await action();
    } catch (err) {
      setError(extractDetail(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const scan = async () => {
    const result = await call(() => voiceLabelingAPI.scanFaces(projectId), 'Не удалось поставить в очередь');
    if (result) onProjectUpdate(result);
  };
  const enroll = async () => {
    const result = await call(() => voiceLabelingAPI.enrollFaces(projectId, { assign, purge }), 'Не удалось записать лица');
    if (result) onProjectUpdate(result);
  };
  const removePreviews = async () => {
    if (await call(() => voiceLabelingAPI.purgeFaces(projectId), 'Не удалось удалить превью')) await load();
  };

  if (data && !data.is_video) return null;

  const enrolled = faceJob?.action === 'faces_enroll' && faceJob.status === 'done' ? faceJob.enroll || [] : [];
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2">Лица участников</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Лица из видео записи, сгруппированные по людям. Впишите ФИО — по ним ВКС потом узнаёт участников без подписи на плитке.
        Лица — биометрия: после записи в эталоны превью удаляются.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button variant="outlined" size="small" onClick={scan} disabled={busy || anyAuxActive || !data}>
          {data?.available ? 'Найти лица заново' : 'Найти лица на видео'}
        </Button>
        {data?.available && (
          <Button variant="outlined" size="small" color="inherit" onClick={removePreviews} disabled={busy || anyAuxActive}>
            Удалить превью
          </Button>
        )}
      </Stack>
      {running && <LinearProgress sx={{ mt: 1 }} />}
      {faceJob?.status === 'failed' && (
        <Alert severity="error" sx={{ mt: 1 }}>{faceJob.error || 'Операция с лицами не выполнена'}</Alert>
      )}
      {enrolled.length > 0 && (
        <Alert severity="success" sx={{ mt: 1 }}>
          Записано в эталоны лиц: {enrolled.map((item) => `${item.name} (${item.faces})`).join(', ')}
        </Alert>
      )}
      {data?.available && data.clusters.length === 0 && (
        <Typography variant="body2" sx={{ mt: 1 }}>Лиц не найдено (подходящих кадров нет).</Typography>
      )}
      {data?.available && data.clusters.length > 0 && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {data.clusters.map((cluster) => (
            <ClusterCard
              key={cluster.id}
              projectId={projectId}
              cluster={cluster}
              choice={draft[cluster.id] || {}}
              people={data.people}
              onChange={(patch) => change(cluster.id, patch)}
            />
          ))}
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }} useFlexGap flexWrap="wrap">
            <Button variant="contained" size="small" onClick={enroll} disabled={busy || anyAuxActive || named === 0}>
              Записать в эталоны лиц{named > 0 ? ` (${named})` : ''}
            </Button>
            <FormControlLabel
              control={<Checkbox size="small" checked={purge} onChange={(e) => setPurge(e.target.checked)} />}
              label="Удалить превью после записи"
            />
          </Stack>
        </Stack>
      )}
    </Paper>
  );
}

export default VoiceLabelFacesPanel;
