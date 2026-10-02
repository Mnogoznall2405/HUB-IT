import { useEffect, useMemo, useState } from 'react';
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
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ScheduleSendRoundedIcon from '@mui/icons-material/ScheduleSendRounded';

import {
  buildSchedulePresets,
  formatScheduledTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  validateScheduleDate,
} from './chatScheduledTime';

// "Send later": choose the date and time of a message (new or an already scheduled one).
export function ScheduleSendDialog({
  open,
  title = 'Отправить позже',
  confirmLabel = 'Запланировать',
  initialBody = '',
  initialDate = null,
  bodyEditable = true,
  busy = false,
  error = '',
  onClose,
  onConfirm,
}) {
  const presets = useMemo(() => (open ? buildSchedulePresets() : []), [open]);
  const [body, setBody] = useState('');
  const [localValue, setLocalValue] = useState('');

  useEffect(() => {
    if (!open) return;
    setBody(String(initialBody || ''));
    setLocalValue(toDateTimeLocalValue(initialDate || buildSchedulePresets()[0].date));
  }, [open, initialBody, initialDate]);

  const date = fromDateTimeLocalValue(localValue);
  const dateError = validateScheduleDate(date);
  const bodyError = !String(body).trim() ? 'Введите текст сообщения' : '';
  const canConfirm = !busy && !dateError && !bodyError;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="chat-schedule-title">
      <DialogTitle id="chat-schedule-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ScheduleSendRoundedIcon fontSize="small" /> {title}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1.25 }}>
          {bodyEditable ? (
            <TextField
              multiline
              minRows={2}
              maxRows={6}
              fullWidth
              label="Сообщение"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              inputProps={{ maxLength: 12000, 'aria-label': 'Текст отложенного сообщения' }}
            />
          ) : null}
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {presets.map((preset) => (
              <Chip
                key={preset.key}
                label={preset.label}
                clickable
                onClick={() => setLocalValue(toDateTimeLocalValue(preset.date))}
              />
            ))}
          </Stack>
          <TextField
            type="datetime-local"
            fullWidth
            label="Дата и время отправки"
            value={localValue}
            onChange={(event) => setLocalValue(event.target.value)}
            InputLabelProps={{ shrink: true }}
            error={Boolean(dateError)}
            helperText={dateError || (date ? `Будет отправлено ${formatScheduledTime(date)}` : ' ')}
            inputProps={{ 'aria-label': 'Дата и время отправки' }}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Отмена</Button>
        <Button
          variant="contained"
          disabled={!canConfirm}
          onClick={() => onConfirm?.(String(body).trim(), date)}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// A line above the composer: how many messages are waiting and when the nearest goes out.
export function ScheduledMessagesBar({ items = [], onOpen }) {
  const waiting = items.filter((item) => item.status === 'scheduled' || item.status === 'sending');
  const failed = items.filter((item) => item.status === 'failed');
  if (!waiting.length && !failed.length) return null;
  const nearest = waiting.length ? waiting[0].scheduled_for : '';
  return (
    <Box
      component="button"
      type="button"
      data-testid="chat-scheduled-bar"
      onClick={onOpen}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        width: '100%',
        px: 1.5,
        minHeight: 36,
        border: 'none',
        bgcolor: 'transparent',
        color: failed.length ? 'error.main' : 'primary.main',
        cursor: 'pointer',
        textAlign: 'left',
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <ScheduleSendRoundedIcon sx={{ fontSize: 18 }} />
      <span>
        {waiting.length ? `Запланировано: ${waiting.length}` : ''}
        {waiting.length && nearest ? ` · ближайшее ${formatScheduledTime(nearest)}` : ''}
        {failed.length ? `${waiting.length ? ' · ' : ''}не отправлено: ${failed.length}` : ''}
      </span>
    </Box>
  );
}

// The list of the user's scheduled messages of the conversation: change time/text, cancel.
export function ScheduledMessagesDialog({ open, items = [], busy = false, error = '', onClose, onEdit, onCancel }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="chat-scheduled-list-title">
      <DialogTitle id="chat-scheduled-list-title">Запланированные сообщения</DialogTitle>
      <DialogContent dividers>
        {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
        {!items.length ? (
          <Typography variant="body2" color="text.secondary">Запланированных сообщений нет.</Typography>
        ) : (
          <Stack spacing={1}>
            {items.map((item) => (
              <Box
                key={item.id}
                data-testid="chat-scheduled-item"
                sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, p: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" color={item.status === 'failed' ? 'error' : 'text.secondary'} fontWeight={700}>
                    {item.status === 'failed'
                      ? `Не отправлено${item.error_text ? `: ${item.error_text}` : ''}`
                      : item.status === 'sending'
                        ? 'Отправляется…'
                        : formatScheduledTime(item.scheduled_for)}
                  </Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{item.body}</Typography>
                </Box>
                <IconButton
                  aria-label="Изменить запланированное сообщение"
                  disabled={busy || item.status === 'sending'}
                  onClick={() => onEdit?.(item)}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label="Отменить запланированное сообщение"
                  disabled={busy || item.status === 'sending'}
                  onClick={() => onCancel?.(item)}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}

// Everything "Send later" that hangs off the composer: the menu on the send button, the dialog that
// schedules the typed text, the list of scheduled messages and the dialog that edits one of them.
export function ChatComposerScheduling({
  scheduled,
  menuAnchor = null,
  onCloseMenu,
  listOpen = false,
  onCloseList,
  messageText = '',
  replyMessage = null,
  onMessageTextChange,
  onClearReply,
}) {
  const [dialog, setDialog] = useState(null); // { mode: 'create' } | { mode: 'edit', item }
  if (!scheduled?.enabled) return null;
  const closeDialog = () => { setDialog(null); scheduled.clearError?.(); };

  return (
    <>
      <Menu open={Boolean(menuAnchor)} anchorEl={menuAnchor} onClose={onCloseMenu}>
        <MenuItem
          data-testid="chat-send-later-menu-item"
          onClick={() => { onCloseMenu?.(); setDialog({ mode: 'create' }); }}
        >
          <ScheduleSendRoundedIcon fontSize="small" sx={{ mr: 1 }} /> Отправить позже
        </MenuItem>
      </Menu>
      <ScheduleSendDialog
        open={dialog?.mode === 'create'}
        initialBody={messageText}
        busy={scheduled.busy}
        error={scheduled.error}
        onClose={closeDialog}
        onConfirm={async (body, date) => {
          const created = await scheduled.schedule(body, date.toISOString(), replyMessage?.id || null);
          if (created) {
            setDialog(null);
            onMessageTextChange?.('');
            onClearReply?.();
          }
        }}
      />
      <ScheduleSendDialog
        open={dialog?.mode === 'edit'}
        title="Изменить запланированное"
        confirmLabel="Сохранить"
        initialBody={dialog?.item?.body || ''}
        initialDate={dialog?.item ? new Date(dialog.item.scheduled_for) : null}
        busy={scheduled.busy}
        error={scheduled.error}
        onClose={closeDialog}
        onConfirm={async (body, date) => {
          const updated = await scheduled.update(dialog.item.id, { body, scheduledFor: date.toISOString() });
          if (updated) setDialog(null);
        }}
      />
      <ScheduledMessagesDialog
        open={listOpen}
        items={scheduled.items}
        busy={scheduled.busy}
        error={scheduled.error}
        onClose={onCloseList}
        onEdit={(item) => { onCloseList?.(); setDialog({ mode: 'edit', item }); }}
        onCancel={(item) => { void scheduled.cancel(item.id); }}
      />
    </>
  );
}
