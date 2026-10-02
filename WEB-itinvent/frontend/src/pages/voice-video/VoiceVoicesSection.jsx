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
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
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
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import { voiceVoicesAPI } from '../../api/voiceVoices';
import { AudioPlayButton, useSingleAudio } from './useSingleAudio.jsx';

const ACCEPT_AUDIO = '.wav,.mp3,.m4a,.flac,.ogg,.aac';

// T26: «Заменить» и «Удалить» — в одном меню «⋮» с прежними правами voice.manage.
const VoiceActions = ({ voice, busy, onReplace, onDelete }) => {
  const [anchor, setAnchor] = useState(null);
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <IconButton
        size="small"
        aria-label={`Действия с голосом ${voice.name}`}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ '@media (pointer: coarse)': { width: 44, height: 44 } }}
      >
        <MoreVertOutlinedIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled={busy} onClick={() => { setAnchor(null); onReplace(); }}>
          <ListItemIcon><AddOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Заменить запись" />
        </MenuItem>
        <MenuItem disabled={busy} onClick={() => { setAnchor(null); onDelete(); }}>
          <ListItemIcon><DeleteOutlineOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Удалить голос" />
        </MenuItem>
      </Menu>
    </Box>
  );
};

function VoiceVoicesSection({ voices = [], canManage = false, onChanged, loading = false, loadError = '' }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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
      {loading && !voices.length ? (
        <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={40} />
          <Skeleton variant="rounded" height={40} />
        </Paper>
      ) : loadError && !voices.length ? (
        // При ошибке загрузки не показываем пустое состояние — сообщение об ошибке выводится отдельно.
        null
      ) : !voices.length ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            Пока ни одного голоса нет. Добавьте запись голоса участника — и система будет узнавать его в новых встречах.
          </Typography>
        </Paper>
      ) : isMobile ? (
        // N13: две компактные строки — заголовок со статусом и «⋮», затем
        // «Записей: N» в одну строку с сэмплами; карточка укладывается в ~120px.
        <Stack spacing={1}>
          {voices.map((v) => (
            <Paper
              key={v.name}
              role="group"
              aria-label={`Голос ${v.name}`}
              variant="outlined"
              sx={{ p: 1.5 }}
            >
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography
                    component="h3"
                    variant="subtitle1"
                    fontWeight={600}
                    sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                  >
                    {v.name}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={v.has_embedding ? 'success' : 'default'}
                    label={v.has_embedding ? 'узнаётся' : 'не готов'}
                  />
                  {canManage && (
                    <VoiceActions voice={v} busy={busy} onReplace={() => openDialog(v)} onDelete={() => remove(v)} />
                  )}
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" color="text.secondary">
                    Записей: {v.samples_count}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Сэмплы</Typography>
                  {(v.samples || []).length ? (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {(v.samples || []).map((s) => {
                        const src = voiceVoicesAPI.sampleUrl(v.name, s);
                        return (
                          <AudioPlayButton
                            key={s}
                            src={src}
                            playing={player.playingSrc === src}
                            onToggle={player.toggle}
                            title={`Прослушать запись голоса ${v.name}, ${s}`}
                          />
                        );
                      })}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">нет записей</Typography>
                  )}
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
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
                          title={`Прослушать запись голоса ${v.name}, ${s}`}
                        />
                      );
                    })}
                  </TableCell>
                  {canManage && (
                    <TableCell align="right" sx={{ width: 56 }}>
                      <VoiceActions voice={v} busy={busy} onReplace={() => openDialog(v)} onDelete={() => remove(v)} />
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
