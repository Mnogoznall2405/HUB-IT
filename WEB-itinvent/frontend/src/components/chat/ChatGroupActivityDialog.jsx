import { useEffect, useState } from 'react';
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

const ACTION_TEXT = {
  members_added: 'добавил(а) участников',
  member_removed: 'исключил(а)',
  role_changed: 'изменил(а) роль',
  ownership_transferred: 'передал(а) права владельца',
  owner_left: 'вышел(а), передав владение',
  profile_updated: 'изменил(а) профиль группы',
  invite_created: 'создал(а) ссылку-приглашение',
  invite_revoked: 'отозвал(а) ссылку-приглашение',
  member_restricted: 'ограничил(а) отправку сообщений',
  restriction_lifted: 'снял(а) ограничение отправки',
  assign_owner: 'назначен владелец администратором',
  auto_assign_owner: 'владелец назначен автоматически',
  remove_member: 'участник исключён администратором',
};

const PROFILE_FIELD_TEXT = {
  title: 'название',
  description: 'описание',
  posting_policy: 'правила отправки',
  slow_mode_seconds: 'медленный режим',
  members_send_files: 'права на файлы',
};

const formatDateTime = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('ru-RU') : '';
};

const describeItem = (item) => {
  const base = ACTION_TEXT[item.action] || item.action;
  const target = item.target_name ? `: ${item.target_name}` : '';
  if (item.action === 'role_changed') {
    return `${base}${target} (${item.details?.role === 'moderator' ? 'модератор' : 'участник'})`;
  }
  if (item.action === 'profile_updated') {
    const fields = (Array.isArray(item.details?.fields) ? item.details.fields : [])
      .map((field) => PROFILE_FIELD_TEXT[field] || field);
    return fields.length ? `${base}: ${fields.join(', ')}` : base;
  }
  return `${base}${target}`;
};

export default function ChatGroupActivityDialog({ open, conversationId, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !conversationId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const data = await chatAPI.getGroupActivity(conversationId);
        if (!cancelled) setItems(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (!cancelled) setError('Не удалось загрузить журнал действий.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  return (
    <Dialog open={Boolean(open)} onClose={onClose} fullWidth maxWidth="sm" data-testid="chat-group-activity">
      <DialogTitle>Журнал действий</DialogTitle>
      <DialogContent dividers>
        {loading ? <CircularProgress size={24} /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!loading && !error && items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Записей пока нет.</Typography>
        ) : null}
        <Stack spacing={1}>
          {items.map((item) => (
            <Typography key={item.id} variant="body2">
              <strong>{item.actor_name || `№${item.actor_user_id}`}</strong> {describeItem(item)}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {formatDateTime(item.created_at)}
              </Typography>
            </Typography>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
