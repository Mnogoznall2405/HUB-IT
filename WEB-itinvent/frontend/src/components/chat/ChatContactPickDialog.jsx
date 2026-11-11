import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { addressBookAPI } from '../../api/addressBook';
import { pickPrimaryPhone, buildEmployeeSubtitle, getEntryKey, getInitials } from '../addressBook/addressBookUtils';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 30;

/** C9: pick a contact from the shared address book, sent as kind='contact'. */
export default function ChatContactPickDialog({
  open,
  onClose,
  onSend,
  ui,
  dialogPaperSx,
  dialogTitleSx,
  dialogContentSx,
  dialogActionsSx,
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setItems([]);
      setLoading(false);
      setSending(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const timeoutId = setTimeout(() => {
      addressBookAPI.search({ q: String(query || '').trim(), limit: SEARCH_LIMIT })
        .then((data) => {
          if (!cancelled) setItems(Array.isArray(data?.items) ? data.items : []);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [open, query]);

  const handleSend = useCallback(async (entry) => {
    if (sending) return;
    const name = String(entry?.full_name || '').trim();
    if (!name) return;
    const phone = pickPrimaryPhone(entry)?.value || '';
    const payload = {
      name,
      phone: phone || undefined,
      organization: String(entry?.department || '').trim() || undefined,
    };
    setSending(true);
    try {
      await onSend?.(payload);
    } finally {
      setSending(false);
    }
  }, [onSend, sending]);

  const listContent = useMemo(() => {
    if (loading) {
      return (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2 }}>
          <CircularProgress size={18} thickness={5} />
          <Typography variant="body2" sx={{ color: ui?.textSecondary }}>Поиск в адресной книге…</Typography>
        </Stack>
      );
    }
    if (items.length === 0) {
      return (
        <Typography variant="body2" sx={{ color: ui?.textSecondary, p: 2 }}>
          Никого не найдено. Уточните имя.
        </Typography>
      );
    }
    return (
      <List disablePadding>
        {items.map((entry, index) => {
          const subtitle = buildEmployeeSubtitle(entry);
          const phone = pickPrimaryPhone(entry)?.value || '';
          return (
            <ListItemButton
              key={getEntryKey(entry, index)}
              onClick={() => void handleSend(entry)}
              disabled={sending}
            >
              <Avatar sx={{ width: 36, height: 36, mr: 1.5, fontSize: 14 }}>
                {getInitials(entry?.full_name)}
              </Avatar>
              <ListItemText
                primary={String(entry?.full_name || '').trim() || 'Без имени'}
                secondary={[subtitle, phone].filter(Boolean).join(' · ')}
              />
            </ListItemButton>
          );
        })}
      </List>
    );
  }, [handleSend, items, loading, sending, ui?.textSecondary]);

  return (
    <Dialog
      open={Boolean(open)}
      onClose={sending ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{ sx: dialogPaperSx }}
      aria-labelledby="chat-contact-pick-title"
    >
      <DialogTitle id="chat-contact-pick-title" sx={dialogTitleSx}>Отправить контакт</DialogTitle>
      <DialogContent sx={dialogContentSx}>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField
            label="Поиск сотрудника"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputProps={{ 'aria-label': 'Поиск сотрудника' }}
            fullWidth
            size="small"
            autoFocus
          />
          <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
            {listContent}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={dialogActionsSx}>
        <Button onClick={onClose} disabled={sending}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
