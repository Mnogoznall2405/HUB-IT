import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
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
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { voiceVoicesAPI } from '../../api/voiceVoices';
import { AudioPlayButton, useSingleAudio } from './useSingleAudio.jsx';

const ACCEPT_AUDIO = '.wav,.mp3,.m4a,.flac,.ogg,.aac';

function VoiceVoicesSection({ voices = [], canManage = false, onChanged }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const player = useSingleAudio();

  const openDialog = (voice = null) => {
    setReplaceTarget(voice);
    setName(voice?.name || '');
    setFile(null);
    setError('');
    setDialogOpen(true);
  };

  const submit = async () => {
    const finalName = replaceTarget ? replaceTarget.name : name.trim();
    if (!finalName || !file || busy) return;
    setBusy(true);
    setError('');
    try {
      await voiceVoicesAPI.enroll(finalName, file, Boolean(replaceTarget));
      setDialogOpen(false);
      setReplaceTarget(null);
      setName('');
      setFile(null);
      setNotice(replaceTarget
        ? `Запись «${finalName}» заменяется — займёт около 30 секунд`
        : 'Новый голос обрабатывается — займёт около 30 секунд');
      onChanged?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Не удалось поставить задачу');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (voice) => {
    if (!window.confirm(`Удалить голос «${voice.name}» и все его сэмплы?`)) return;
    setError('');
    try {
      await voiceVoicesAPI.remove(voice.name);
      onChanged?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Удаление не удалось');
    }
  };

  return (
    <Box>
      {player.audioEl}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          Знакомые голоса участников — система узнаёт их в новых записях. Для добавления нужно 5–30 секунд чистой речи.
        </Typography>
        {canManage && (
          <Button size="small" variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => openDialog()}>
            Добавить голос
          </Button>
        )}
      </Box>
      {notice && <Alert severity="info" sx={{ mb: 1 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
      {!voices.length ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            Пока ни одного голоса нет. Добавьте запись голоса участника — и система будет узнавать его в новых встречах.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Имя</TableCell>
                <TableCell>Записей</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Прослушать</TableCell>
                {canManage && <TableCell align="right">Действия</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {voices.map((v) => (
                <TableRow key={v.name} hover>
                  <TableCell>{v.name}</TableCell>
                  <TableCell>{v.samples_count}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={v.has_embedding ? 'success' : 'default'}
                      label={v.has_embedding ? 'узнаётся' : 'не готов'}
                    />
                  </TableCell>
                  <TableCell>
                    {(v.samples || []).map((s) => {
                      const src = voiceVoicesAPI.sampleUrl(v.name, s);
                      return (
                        <AudioPlayButton
                          key={s}
                          src={src}
                          playing={player.playingSrc === src}
                          onToggle={player.toggle}
                          title={`Прослушать: ${s}`}
                        />
                      );
                    })}
                  </TableCell>
                  {canManage && (
                    <TableCell align="right">
                      <Tooltip title="Заменить сэмпл">
                        <IconButton size="small" aria-label={`Заменить запись голоса ${v.name}`} onClick={() => openDialog(v)}>
                          <AddOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Удалить голос">
                        <IconButton size="small" color="error" aria-label={`Удалить голос ${v.name}`} onClick={() => remove(v)}>
                          <DeleteOutlineOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={dialogOpen} onClose={busy ? undefined : () => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{replaceTarget ? `Заменить запись голоса: ${replaceTarget.name}` : 'Новый голос'}</DialogTitle>
        <DialogContent dividers>
          {replaceTarget ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Текущая запись голоса «{replaceTarget.name}» будет заменена новой.
            </Alert>
          ) : (
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Имя участника"
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ mb: 2 }}
            />
          )}
          <Button variant="outlined" component="label" fullWidth disabled={busy}>
            {file ? file.name : 'Выбрать аудио (5–30 с чистой речи)'}
            <input
              hidden
              type="file"
              accept={ACCEPT_AUDIO}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Button>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); setReplaceTarget(null); }} disabled={busy}>Отмена</Button>
          <Button variant="contained" onClick={submit} disabled={(!replaceTarget && !name.trim()) || !file || busy}>
            {busy ? 'Отправляю…' : replaceTarget ? 'Заменить' : 'Добавить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default VoiceVoicesSection;
