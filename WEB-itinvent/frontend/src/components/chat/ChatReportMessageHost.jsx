import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import chatConversationDetailsAPI from '../../api/chatConversationDetails';
import { clearMessageReportRequest, useMessageReportRequest } from './chatReportRequest';

const REASONS = [
  ['spam', 'Спам или реклама'],
  ['abuse', 'Оскорбления'],
  ['illegal', 'Запрещённый контент'],
  ['other', 'Другое'],
];

// "Пожаловаться" from the message menu: in a group the report goes to its owner and moderators.
export default function ChatReportMessageHost({ conversation }) {
  const request = useMessageReportRequest();
  const [reason, setReason] = useState('spam');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const messageId = request?.messageId || '';
  const conversationId = request?.conversationId || String(conversation?.id || '').trim();
  const isGroup = String(conversation?.kind || '').trim() === 'group';

  useEffect(() => {
    setReason('spam');
    setComment('');
    setBusy(false);
    setError('');
    setSent(false);
  }, [messageId]);

  if (!request) return null;

  const handleSend = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await chatConversationDetailsAPI.reportMessage(conversationId, request.messageId, { reason, comment });
      setSent(true);
    } catch (err) {
      setError(String(err?.response?.data?.detail || err?.message || 'Не удалось отправить жалобу.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={clearMessageReportRequest} fullWidth maxWidth="xs" data-testid="chat-report-dialog">
      <DialogTitle>Пожаловаться на сообщение</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {request.senderName || request.preview ? (
            <Typography variant="body2" color="text.secondary" noWrap>
              {[request.senderName, request.preview].filter(Boolean).join(': ')}
            </Typography>
          ) : null}
          {!isGroup ? (
            <Alert severity="info">Жалобы принимаются в группах: их разбирают владелец и модераторы.</Alert>
          ) : sent ? (
            <Alert severity="success" data-testid="chat-report-sent">
              Жалоба отправлена владельцу и модераторам группы.
            </Alert>
          ) : (
            <>
              <RadioGroup value={reason} onChange={(event) => setReason(event.target.value)}>
                {REASONS.map(([value, label]) => (
                  <FormControlLabel key={value} value={value} control={<Radio size="small" />} label={label} />
                ))}
              </RadioGroup>
              <TextField
                size="small"
                multiline
                minRows={2}
                label="Комментарий (необязательно)"
                value={comment}
                onChange={(event) => setComment(event.target.value.slice(0, 500))}
              />
              {error ? <Alert severity="error">{error}</Alert> : null}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={clearMessageReportRequest}>{sent || !isGroup ? 'Закрыть' : 'Отмена'}</Button>
        {isGroup && !sent ? (
          <Button variant="contained" onClick={handleSend} disabled={busy} data-testid="chat-report-submit">
            Отправить
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
