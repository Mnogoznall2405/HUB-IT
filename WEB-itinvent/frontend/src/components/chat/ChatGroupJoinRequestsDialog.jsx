import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material';

import chatConversationDetailsAPI from '../../api/chatConversationDetails';

const formatDateTime = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('ru-RU') : '';
};

// Join by approval for the group's invite link: the switch and the waiting requests, for the owner
// and moderators.
export default function ChatGroupJoinRequestsDialog({ open, conversationId, onClose, onChanged }) {
  const [items, setItems] = useState([]);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError('');
    try {
      const data = await chatConversationDetailsAPI.listJoinRequests(conversationId);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setApprovalRequired(Boolean(data?.approval_required));
      onChanged?.({ count: Number(data?.open_count || 0), approvalRequired: Boolean(data?.approval_required) });
    } catch (err) {
      setError(String(err?.response?.data?.detail || 'Не удалось загрузить заявки.'));
    } finally {
      setLoading(false);
    }
  }, [conversationId, onChanged]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggleApproval = async (event) => {
    const next = Boolean(event.target.checked);
    if (busyId) return;
    setBusyId('switch');
    setError('');
    try {
      await chatConversationDetailsAPI.setJoinApproval(conversationId, next);
      await load();
    } catch (err) {
      setError(String(err?.response?.data?.detail || 'Не удалось изменить настройку.'));
    } finally {
      setBusyId('');
    }
  };

  const decide = async (item, decision) => {
    if (busyId) return;
    setBusyId(item.id);
    setError('');
    try {
      await chatConversationDetailsAPI.resolveJoinRequest(conversationId, item.id, decision);
      await load();
    } catch (err) {
      setError(String(err?.response?.data?.detail || 'Не удалось обработать заявку.'));
    } finally {
      setBusyId('');
    }
  };

  return (
    <Dialog open={Boolean(open)} onClose={onClose} fullWidth maxWidth="sm" data-testid="chat-group-join-requests">
      <DialogTitle>Заявки на вступление</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <FormControlLabel
            control={(
              <Switch
                checked={approvalRequired}
                onChange={toggleApproval}
                disabled={Boolean(busyId)}
                inputProps={{ 'data-testid': 'chat-join-approval-switch' }}
              />
            )}
            label="Вступление по ссылке только с одобрения"
          />
          {loading ? <CircularProgress size={24} /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {!loading && !error && items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">Заявок нет.</Typography>
          ) : null}
          {items.map((item) => (
            <Stack key={item.id} spacing={0.5} data-testid="chat-group-join-request-item">
              <Typography variant="body2">
                <strong>{item.user_name}</strong>
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {formatDateTime(item.created_at)}
                </Typography>
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={Boolean(busyId)}
                  onClick={() => void decide(item, 'approve')}
                  data-testid="chat-join-request-approve"
                >
                  Принять
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={Boolean(busyId)}
                  onClick={() => void decide(item, 'reject')}
                  data-testid="chat-join-request-reject"
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
