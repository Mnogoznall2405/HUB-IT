import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';

import { chatAPI } from '../../api/client';
import chatConversationDetailsAPI from '../../api/chatConversationDetails';

const REASON_TEXT = {
  spam: 'спам или реклама',
  abuse: 'оскорбления',
  illegal: 'запрещённый контент',
  other: 'другое',
};

const formatDateTime = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('ru-RU') : '';
};

// Open complaints of a group for its owner and moderators: delete the message or dismiss the complaint.
export default function ChatGroupReportsDialog({ open, conversationId, onClose, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError('');
    try {
      const data = await chatConversationDetailsAPI.listMessageReports(conversationId);
      setItems(Array.isArray(data?.items) ? data.items : []);
      onChanged?.(Number(data?.open_count || 0));
    } catch (err) {
      setError(String(err?.response?.data?.detail || 'Не удалось загрузить жалобы.'));
    } finally {
      setLoading(false);
    }
  }, [conversationId, onChanged]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const resolve = async (item, { deleteMessage }) => {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    try {
      if (deleteMessage) await chatAPI.deleteChatMessage(conversationId, item.message_id);
      await chatConversationDetailsAPI.resolveMessageReport(
        conversationId,
        item.id,
        deleteMessage ? 'resolved' : 'dismissed',
      );
      await load();
    } catch (err) {
      setError(String(err?.response?.data?.detail || 'Не удалось обработать жалобу.'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <Dialog open={Boolean(open)} onClose={onClose} fullWidth maxWidth="sm" data-testid="chat-group-reports">
      <DialogTitle>Жалобы</DialogTitle>
      <DialogContent dividers>
        {loading ? <CircularProgress size={24} /> : null}
        {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
        {!loading && !error && items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Открытых жалоб нет.</Typography>
        ) : null}
        <Stack spacing={2}>
          {items.map((item) => (
            <Stack key={item.id} spacing={0.5} data-testid="chat-group-report-item">
              <Typography variant="body2">
                <strong>{item.reporter_name}</strong> на сообщение <strong>{item.sender_name}</strong>
                {' — '}{REASON_TEXT[item.reason] || item.reason}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {formatDateTime(item.created_at)}
                </Typography>
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {item.message_preview}
              </Typography>
              {item.comment ? <Typography variant="caption">Комментарий: {item.comment}</Typography> : null}
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  disabled={Boolean(busyId)}
                  onClick={() => void resolve(item, { deleteMessage: true })}
                  data-testid="chat-report-delete-message"
                >
                  Удалить сообщение
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={Boolean(busyId)}
                  onClick={() => void resolve(item, { deleteMessage: false })}
                  data-testid="chat-report-dismiss"
                >
                  Отклонить
                </Button>
              </Stack>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
