import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import SendIcon from '@mui/icons-material/Send';
import { ticketsAPI } from '../../api/tickets';
import {
  ATTACHMENT_TYPES,
  STATUS_COLORS,
  STATUS_LABELS,
  TICKET_STATUS_OPTIONS,
  downloadBlob,
  formatDate,
  formatDateTime,
  formatMoney,
  getErrorMessage,
} from './ticketUi';

const Info = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 600 }}>{value || '-'}</Typography>
  </Box>
);

export default function TicketRequestCard({ requestId, canWrite = false, onChanged }) {
  const [request, setRequest] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusDialog, setStatusDialog] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [statusComment, setStatusComment] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentType, setCommentType] = useState('normal');
  const [fileType, setFileType] = useState('other');

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError('');
    try {
      const [requestData, commentsData, historyData, attachmentData] = await Promise.all([
        ticketsAPI.getRequest(requestId),
        ticketsAPI.listComments(requestId),
        ticketsAPI.listHistory(requestId),
        ticketsAPI.listAttachments(requestId),
      ]);
      setRequest(requestData);
      setComments(Array.isArray(commentsData?.items) ? commentsData.items : []);
      setHistory(Array.isArray(historyData?.items) ? historyData.items : []);
      setAttachments(Array.isArray(attachmentData?.items) ? attachmentData.items : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!requestId) {
    return (
      <Alert severity="info">Выберите заявку из списка, чтобы открыть карточку.</Alert>
    );
  }

  const changeStatus = async () => {
    if (!nextStatus || !request) return;
    await ticketsAPI.changeStatus(request.id, {
      new_status: nextStatus,
      expected_version: request.version,
      comment: statusComment,
    });
    setStatusDialog(false);
    setNextStatus('');
    setStatusComment('');
    await load();
    onChanged?.();
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    await ticketsAPI.addComment(requestId, { text: commentText.trim(), comment_type: commentType });
    setCommentText('');
    await load();
  };

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await ticketsAPI.uploadAttachment(requestId, { file, fileType });
    await load();
  };

  const downloadAttachment = async (attachment) => {
    const blob = await ticketsAPI.downloadAttachment(requestId, attachment.id);
    downloadBlob(blob, attachment.file_name || 'attachment');
  };

  const deleteAttachment = async (attachment) => {
    await ticketsAPI.deleteAttachment(requestId, attachment.id);
    await load();
  };

  return (
    <Stack spacing={2}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {request ? (
        <>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
            <Box>
              <Typography variant="h6">Заявка #{request.id}</Typography>
              <Typography variant="body2" color="text.secondary">{request.employee_name || '-'}</Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip color={STATUS_COLORS[request.status] || 'default'} label={STATUS_LABELS[request.status] || request.status} />
              {canWrite ? <Button variant="contained" onClick={() => setStatusDialog(true)}>Сменить статус</Button> : null}
            </Stack>
          </Stack>

          <Grid container spacing={2}>
            <Grid item xs={12} md={3}><Info label="Сотрудник" value={request.employee_name} /></Grid>
            <Grid item xs={12} md={3}><Info label="Объект" value={request.object_name || request.object_code} /></Grid>
            <Grid item xs={12} md={3}><Info label="Вылет" value={formatDate(request.departure_date)} /></Grid>
            <Grid item xs={12} md={3}><Info label="Прибытие" value={formatDate(request.arrival_date)} /></Grid>
            <Grid item xs={12} md={6}><Info label="Маршрут" value={request.route} /></Grid>
            <Grid item xs={12} md={3}><Info label="Ответственный" value={request.assignee_name || 'Без ответственного'} /></Grid>
            <Grid item xs={12} md={3}><Info label="Стоимость" value={formatMoney(request.total_cost)} /></Grid>
          </Grid>

          <Tabs value={tab} onChange={(_, value) => setTab(value)}>
            <Tab label="Комментарии" />
            <Tab label="История" />
            <Tab label="Вложения" />
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1.5}>
              {canWrite ? (
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <TextField
                    label="Комментарий"
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    size="small"
                    fullWidth
                    inputProps={{ maxLength: 2000 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 170 }}>
                    <InputLabel>Тип</InputLabel>
                    <Select value={commentType} label="Тип" onChange={(event) => setCommentType(event.target.value)}>
                      <MenuItem value="normal">Обычный</MenuItem>
                      <MenuItem value="problem">Проблема</MenuItem>
                      <MenuItem value="clarification">Уточнение</MenuItem>
                    </Select>
                  </FormControl>
                  <Button startIcon={<SendIcon />} variant="contained" onClick={addComment}>Добавить</Button>
                </Stack>
              ) : null}
              {comments.map((item) => (
                <Box key={item.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={item.comment_type} />
                    <Typography variant="caption" color="text.secondary">{formatDateTime(item.created_at)}</Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{item.text}</Typography>
                </Box>
              ))}
              {comments.length === 0 ? <Typography color="text.secondary">Комментариев пока нет</Typography> : null}
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={1}>
              {history.map((item) => (
                <Box key={item.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.field_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{formatDateTime(item.created_at)}</Typography>
                  <Typography variant="body2">{item.old_value || '-'} {'->'} {item.new_value || '-'}</Typography>
                  {item.comment ? <Typography variant="body2" color="text.secondary">{item.comment}</Typography> : null}
                </Box>
              ))}
              {history.length === 0 ? <Typography color="text.secondary">История пуста</Typography> : null}
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={1.5}>
              {canWrite ? (
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Тип файла</InputLabel>
                    <Select value={fileType} label="Тип файла" onChange={(event) => setFileType(event.target.value)}>
                      {ATTACHMENT_TYPES.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <Button component="label" startIcon={<AttachFileIcon />} variant="outlined">
                    Загрузить
                    <input type="file" hidden onChange={uploadFile} />
                  </Button>
                </Stack>
              ) : null}
              {attachments.map((item) => (
                <Stack key={item.id} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="body2">{item.file_name} ({Math.round((item.file_size || 0) / 1024)} КБ)</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" startIcon={<DownloadIcon />} onClick={() => downloadAttachment(item)}>Скачать</Button>
                    {canWrite ? <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => deleteAttachment(item)}>Удалить</Button> : null}
                  </Stack>
                </Stack>
              ))}
              {attachments.length === 0 ? <Typography color="text.secondary">Вложений нет</Typography> : null}
            </Stack>
          ) : null}

          <Dialog open={statusDialog} onClose={() => setStatusDialog(false)} fullWidth maxWidth="xs">
            <DialogTitle>Смена статуса</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Новый статус</InputLabel>
                  <Select value={nextStatus} label="Новый статус" onChange={(event) => setNextStatus(event.target.value)}>
                    {TICKET_STATUS_OPTIONS.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField label="Комментарий" value={statusComment} onChange={(event) => setStatusComment(event.target.value)} multiline minRows={3} />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setStatusDialog(false)}>Отмена</Button>
              <Button variant="contained" onClick={changeStatus} disabled={!nextStatus}>Сохранить</Button>
            </DialogActions>
          </Dialog>
        </>
      ) : null}
    </Stack>
  );
}
