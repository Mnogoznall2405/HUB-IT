import React, { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import { voiceJobsAPI } from '../../api/voiceJobs';

const DEFAULT_SETTINGS = {
  stt_engine: 'gemini',
  whisper_model: 'bzikst/faster-whisper-large-v3-ru-podlodka',
  language: 'ru',
  separator: 'kim',
  num_speakers: 0,
  enable_diarization: true,
  enable_alignment: true,
  enable_ai_analysis: true,
  enable_speaker_identification: true,
  meeting_date: '',
  custom_vocabulary: '',
  fresh: false,
  llm_model: '',
  segmentation_model: '',
  topic_model: '',
};

const ACCEPT = '.mp3,.wav,.flac,.m4a,.aac,.ogg,.wma,.mp4,.mkv,.mov,.avi,.webm,.wmv,.flv,.m4v';

function LlmModelField({ label, value, onChange, options, defaultValue }) {
  const values = (options || []).map((o) => o.value);
  return (
    <Autocomplete
      freeSolo
      size="small"
      options={values}
      value={value}
      onChange={(_e, v) => onChange(v || '')}
      onInputChange={(_e, v) => onChange(v || '')}
      fullWidth
      renderOption={(props, option) => {
        const meta = (options || []).find((o) => o.value === option);
        return (
          <li {...props} key={option}>
            <Box>
              <Typography variant="body2">{meta?.label || option}</Typography>
              <Typography variant="caption" color="text.secondary">{option}</Typography>
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={defaultValue ? `По умолчанию: ${defaultValue}` : 'По умолчанию'}
        />
      )}
    />
  );
}

function VoiceUploadDialog({ open, onClose, onUploaded, options }) {
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [error, setError] = useState('');

  const set = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const isApiStt = settings.stt_engine && settings.stt_engine !== 'whisper';
  const maxBytes = options?.upload_max_bytes || 0;
  const llmDefaults = options?.llm_defaults || {};
  const llmModels = options?.llm_models || [];

  const acceptedExts = useMemo(
    () => new Set(ACCEPT.split(',').map((e) => e.trim().toLowerCase())),
    [],
  );

  const addFiles = (list) => {
    const next = Array.from(list || []).filter((f) => {
      const ext = `.${f.name.split('.').pop()?.toLowerCase()}`;
      return acceptedExts.has(ext);
    });
    if (next.length) setFiles((prev) => [...prev, ...next]);
  };

  const oversized = useMemo(
    () => files.filter((f) => maxBytes && f.size > maxBytes),
    [files, maxBytes],
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const dateInFuture = Boolean(
    settings.meeting_date && /^\d{4}-\d{2}-\d{2}$/.test(settings.meeting_date)
      && settings.meeting_date > todayIso,
  );

  const reset = () => {
    setFiles([]);
    setSettings(DEFAULT_SETTINGS);
    setProgress(0);
    setCurrentIdx(0);
    setError('');
    setBusy(false);
  };

  const handleSubmit = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    setError('');
    const isoDate = settings.meeting_date || '';
    const meetingDate = /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
      ? isoDate.split('-').reverse().join('.')
      : '';
    const payload = {
      ...settings,
      num_speakers: Math.min(20, Math.max(0, Number(settings.num_speakers) || 0)),
      meeting_date: meetingDate || undefined,
      llm_model: settings.llm_model?.trim() || undefined,
      segmentation_model: settings.segmentation_model?.trim() || undefined,
      topic_model: settings.topic_model?.trim() || undefined,
    };
    if (payload.stt_engine === 'whisper') delete payload.stt_engine;
    const failures = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        setCurrentIdx(i);
        setProgress(0);
        try {
          // eslint-disable-next-line no-await-in-loop
          await voiceJobsAPI.uploadJob(files[i], payload, (event) => {
            if (event.total) setProgress(Math.round((event.loaded / event.total) * 100));
          });
        } catch (err) {
          const detail = err?.response?.data?.detail;
          failures.push(`${files[i].name}: ${typeof detail === 'string' ? detail : 'ошибка отправки'}`);
        }
      }
      if (!failures.length) {
        reset();
        onUploaded?.();
        return;
      }
      setError(`Отправлено ${files.length - failures.length} из ${files.length}. Не отправлены: ${failures.join('; ')}`);
      setBusy(false);
      onUploaded?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Не удалось отправить файл');
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Обработать запись</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Paper
            component="label"
            variant="outlined"
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!busy) addFiles(e.dataTransfer?.files);
            }}
            sx={{
              p: 2.5,
              borderStyle: 'dashed',
              borderWidth: 2,
              borderColor: dragOver ? 'primary.main' : 'divider',
              bgcolor: dragOver ? 'action.hover' : 'transparent',
              textAlign: 'center',
              cursor: busy ? 'default' : 'pointer',
              transition: 'border-color .15s, background-color .15s',
            }}
          >
            <Typography variant="body2">
              Перетащите сюда аудио/видео или нажмите для выбора
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Можно несколько файлов — они встанут в очередь по очереди
            </Typography>
            <input
              hidden
              type="file"
              multiple
              accept={ACCEPT}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </Paper>
          {files.length > 0 && (
            <Stack spacing={0.5}>
              {files.map((f, idx) => {
                const tooBig = Boolean(maxBytes && f.size > maxBytes);
                return (
                  <Stack key={`${f.name}-${idx}`} direction="row" spacing={1} alignItems="center">
                    <Typography
                      variant="caption"
                      color={tooBig ? 'error' : 'text.secondary'}
                      sx={{ flex: 1, minWidth: 0 }}
                      noWrap
                    >
                      {idx === currentIdx && busy ? '→ ' : ''}{f.name} · {(f.size / 1024 / 1024).toFixed(1)} МБ
                      {tooBig ? ` — больше лимита ${(maxBytes / 1024 / 1024 / 1024).toFixed(1)} ГБ` : ''}
                    </Typography>
                    {!busy && (
                      <IconButton size="small" aria-label={`Убрать ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}>
                        <CloseOutlinedIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          )}

          <Divider textAlign="left">Запись</Divider>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              size="small"
              type="date"
              label="Дата встречи"
              InputLabelProps={{ shrink: true }}
              value={settings.meeting_date}
              onChange={(e) => set('meeting_date', e.target.value)}
              error={dateInFuture}
              helperText={dateInFuture ? 'Дата встречи не может быть в будущем' : 'Пусто — определим из имени файла'}
              fullWidth
            />
            <TextField
              size="small"
              type="number"
              label="Число участников"
              value={settings.num_speakers}
              inputProps={{ min: 0, max: 20 }}
              onChange={(e) => set('num_speakers', Math.min(20, Math.max(0, Number(e.target.value) || 0)))}
              helperText="0 — определить автоматически"
              fullWidth
            />
          </Stack>
          <FormControl size="small" fullWidth>
            <InputLabel>Язык записи</InputLabel>
            <Select
              label="Язык записи"
              value={settings.language}
              onChange={(e) => set('language', e.target.value)}
            >
              {(options?.languages || [{ value: 'ru', label: 'Русский' }]).map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Divider textAlign="left">Что сделать с записью</Divider>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0 }}>
            <FormControlLabel
              control={<Switch checked={settings.enable_diarization} onChange={(e) => set('enable_diarization', e.target.checked)} />}
              label="Разделить, кто говорит"
            />
            <FormControlLabel
              control={<Switch checked={settings.enable_speaker_identification} disabled={!settings.enable_diarization} onChange={(e) => set('enable_speaker_identification', e.target.checked)} />}
              label="Узнать знакомые голоса"
            />
            <FormControlLabel
              control={<Switch checked={settings.enable_ai_analysis} onChange={(e) => set('enable_ai_analysis', e.target.checked)} />}
              label="Составить протокол и выводы"
            />
            <FormControlLabel
              control={<Switch checked={settings.fresh} onChange={(e) => set('fresh', e.target.checked)} />}
              label="Обработать заново с нуля"
            />
          </Box>

          <Accordion
            variant="outlined"
            disableGutters
            sx={{ '&:before': { display: 'none' }, boxShadow: 'none' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2">Дополнительные настройки</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Распознавание речи</InputLabel>
                    <Select
                      label="Распознавание речи"
                      value={settings.stt_engine}
                      onChange={(e) => set('stt_engine', e.target.value)}
                    >
                      {(options?.stt_engines || []).map((o) => (
                        <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                      ))}
                      {!options?.stt_engines?.length && <MenuItem value="whisper">Локально (WhisperX, GPU)</MenuItem>}
                    </Select>
                  </FormControl>
                  {!isApiStt && (
                    <FormControl size="small" fullWidth>
                      <InputLabel>Модель распознавания</InputLabel>
                      <Select
                        label="Модель распознавания"
                        value={settings.whisper_model}
                        onChange={(e) => set('whisper_model', e.target.value)}
                      >
                        {(options?.whisper_models || [DEFAULT_SETTINGS.whisper_model]).map((m) => (
                          <MenuItem key={m} value={m}>{m}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Очистка голоса</InputLabel>
                    <Select
                      label="Очистка голоса"
                      value={settings.separator}
                      onChange={(e) => set('separator', e.target.value)}
                    >
                      {(options?.separator_engines || []).map((o) => (
                        <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
                <FormControlLabel
                  control={<Switch checked={settings.enable_alignment} onChange={(e) => set('enable_alignment', e.target.checked)} />}
                  label="Точные таймкоды слов (обработка дольше)"
                />

                {settings.enable_ai_analysis && (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      Модели анализа — пусто: используются настроенные по умолчанию.
                    </Typography>
                    <LlmModelField
                      label="Основная модель (анализ и итоги)"
                      value={settings.llm_model}
                      onChange={(v) => set('llm_model', v)}
                      options={llmModels}
                      defaultValue={llmDefaults.DEFAULT_LLM_MODEL}
                    />
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <LlmModelField
                        label="Разбивка на разделы"
                        value={settings.segmentation_model}
                        onChange={(v) => set('segmentation_model', v)}
                        options={llmModels}
                        defaultValue={llmDefaults.SEGMENTATION_MODEL}
                      />
                      <LlmModelField
                        label="Темы и выводы"
                        value={settings.topic_model}
                        onChange={(v) => set('topic_model', v)}
                        options={llmModels}
                        defaultValue={llmDefaults.TOPIC_ANALYSIS_MODEL}
                      />
                    </Stack>
                  </>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>

          {busy && (
            <Box>
              <LinearProgress variant={progress > 0 ? 'determinate' : 'indeterminate'} value={progress} />
              <Typography variant="caption" color="text.secondary">
                Загрузка файла {currentIdx + 1} из {files.length}… {progress}%
              </Typography>
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { reset(); onClose?.(); }} disabled={busy}>Отмена</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!files.length || busy || oversized.length > 0 || dateInFuture}>
          {busy ? 'Загружается…' : files.length > 1 ? `Отправить ${files.length} файла` : 'Отправить на обработку'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default VoiceUploadDialog;
