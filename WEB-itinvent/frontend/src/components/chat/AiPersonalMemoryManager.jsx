import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';

// Personal memory of the assistant, managed as in ChatGPT: the switch, the list of remembered facts,
// edit / delete one, clear all. Used in the AI conversation panel and in the user's settings.
// `memory` is the result of useAiPersonalMemory.
export default function AiPersonalMemoryManager({ memory, available = true, unavailableText = '' }) {
  const [editingMemory, setEditingMemory] = useState(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState('');
  const [clearMemoryOpen, setClearMemoryOpen] = useState(false);

  const beginEditMemory = (item) => {
    setEditingMemory(item);
    setEditingMemoryContent(String(item?.content || '').trim());
  };
  const submitMemoryEdit = async () => {
    const updated = await memory.updateItem(editingMemory?.id, editingMemoryContent);
    if (updated) {
      setEditingMemory(null);
      setEditingMemoryContent('');
    }
  };

  if (!available) {
    return unavailableText ? (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
        {unavailableText}
      </Typography>
    ) : null;
  }

  return (
    <>
      <Stack spacing={1} sx={{ mt: 0.5, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Сохранённые предпочтения используются между диалогами HUB Ассистента. Их видите только вы.
        </Typography>
        <FormControlLabel
          control={(
            <Switch
              checked={memory.enabled}
              disabled={memory.busyKey === 'settings' || memory.loading}
              onChange={(event) => void memory.updateEnabled(event.target.checked)}
              inputProps={{ 'aria-label': 'Использовать личную память' }}
            />
          )}
          label="Использовать ваши предпочтения между диалогами"
          sx={{ minHeight: 44, m: 0 }}
        />
        <Typography variant="body2" color="text.secondary">
          Сохранено фактов: {memory.loading ? '…' : memory.items.length}
        </Typography>
        {memory.loading ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 44 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Загружаю память…</Typography>
          </Stack>
        ) : null}
        {memory.error ? <Alert severity="error">{memory.error}</Alert> : null}
        {memory.notice ? (
          <Alert severity={memory.noticeSeverity || 'success'} onClose={memory.dismissNotice}>{memory.notice}</Alert>
        ) : null}
        {!memory.loading && memory.items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Сохранённых предпочтений и рабочих фактов пока нет.
          </Typography>
        ) : null}
        {memory.items.map((item) => (
          <Box
            key={item.id}
            sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, p: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}
          >
            <MemoryRoundedIcon color="action" fontSize="small" sx={{ mt: 1.25 }} />
            <Box sx={{ minWidth: 0, flex: 1, py: 0.75 }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.content}</Typography>
              {item.category ? <Typography variant="caption" color="text.secondary">{item.category}</Typography> : null}
            </Box>
            <IconButton
              aria-label="Изменить факт памяти"
              disabled={memory.busyKey === String(item.id)}
              onClick={() => beginEditMemory(item)}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
            <IconButton
              aria-label="Удалить факт памяти"
              disabled={memory.busyKey === String(item.id)}
              onClick={() => void memory.deleteItem(item.id)}
              sx={{ minWidth: 44, minHeight: 44 }}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        {memory.items.length > 0 ? (
          <Button
            color="error"
            startIcon={<DeleteOutlineRoundedIcon />}
            disabled={memory.busyKey === 'clear'}
            onClick={() => setClearMemoryOpen(true)}
            sx={{ minHeight: 44, justifyContent: 'flex-start' }}
          >
            Очистить всю память
          </Button>
        ) : null}
      </Stack>
      <Dialog
        open={Boolean(editingMemory)}
        onClose={() => setEditingMemory(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="ai-memory-edit-title"
      >
        <DialogTitle id="ai-memory-edit-title">Изменить факт памяти</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            margin="dense"
            label="Что помощнику нужно помнить"
            value={editingMemoryContent}
            onChange={(event) => setEditingMemoryContent(event.target.value)}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingMemory(null)} sx={{ minHeight: 44 }}>Отмена</Button>
          <Button
            variant="contained"
            disabled={!editingMemoryContent.trim() || memory.busyKey === String(editingMemory?.id || '')}
            onClick={() => void submitMemoryEdit()}
            sx={{ minHeight: 44 }}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={clearMemoryOpen}
        onClose={() => setClearMemoryOpen(false)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="ai-memory-clear-title"
      >
        <DialogTitle id="ai-memory-clear-title">Очистить личную память?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Все сохранённые предпочтения и рабочие факты будут удалены. История чатов не изменится.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearMemoryOpen(false)} sx={{ minHeight: 44 }}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disabled={memory.busyKey === 'clear'}
            onClick={async () => {
              const cleared = await memory.clear();
              if (cleared) setClearMemoryOpen(false);
            }}
            sx={{ minHeight: 44 }}
          >
            Очистить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
