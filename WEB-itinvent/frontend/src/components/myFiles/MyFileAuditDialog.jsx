import { useEffect, useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { myFilesAPI } from '../../api/myFiles';

const ACTION_LABELS = {
  upload_reserved: 'Загрузка зарезервирована',
  upload_completed: 'Загрузка завершена',
  upload_aborted: 'Загрузка отменена',
  upload_expired: 'Резервация загрузки истекла',
  file_updated: 'Файл обновлён',
  trashed: 'Удалён в корзину',
  restored: 'Восстановлен из корзины',
  purged: 'Удалён навсегда',
  expired: 'Истёк срок хранения',
  share_created: 'Создана публичная ссылка',
  share_rotated: 'Публичная ссылка перевыпущена',
  share_revoked: 'Публичная ссылка отключена',
  download_grant_created: 'Выдан грант на скачивание',
  owner_download_started: 'Скачивание владельцем',
  public_download_started: 'Скачивание по публичной ссылке',
  security_scan_clean: 'Проверка безопасности: чисто',
  security_scan_blocked: 'Проверка безопасности: заблокировано',
  security_scan_error: 'Проверка безопасности: ошибка',
  security_scan_skipped: 'Проверка безопасности: пропущена',
};

const auditActionLabel = (action) => ACTION_LABELS[action] || String(action || 'событие');

const formatAuditTime = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const auditActorLabel = (item) => {
  const name = String(item?.actor_username || '').trim();
  if (name) return name;
  const action = String(item?.action || '');
  return action.startsWith('public_') ? 'гость по ссылке' : 'система';
};

const auditSourceLabel = (item) => {
  const parts = [];
  if (item?.ip_address) parts.push(`IP ${item.ip_address}`);
  const agent = String(item?.user_agent || '').trim();
  if (agent) parts.push(agent.length > 80 ? `${agent.slice(0, 80)}…` : agent);
  return parts.join(' · ');
};

export default function MyFileAuditDialog({ open, file, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [items, setItems] = useState([]);
  const [downloadCount, setDownloadCount] = useState(0);
  const [uniqueIps, setUniqueIps] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fileId = String(file?.id || '');
  const fileName = String(file?.original_file_name || file?.download_file_name || 'файл');

  useEffect(() => {
    if (!open || !fileId) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    myFilesAPI.listFileAudit(fileId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setDownloadCount(Number(data?.download_count || 0));
        setUniqueIps(Number(data?.unique_download_ips || 0));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(String(err?.response?.data?.detail || err?.message || 'Не удалось загрузить журнал'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fileId, open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>
          Журнал
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 4 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : error ? (
          <Typography variant="body2" color="error" sx={{ p: 2 }}>{error}</Typography>
        ) : (
          <>
            <Stack direction="row" spacing={2} sx={{ px: 2, py: 1.25 }}>
              <Typography variant="body2" data-testid="my-files-audit-download-count">
                Скачиваний: <b>{downloadCount}</b>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                уникальных IP: <b>{uniqueIps}</b>
              </Typography>
            </Stack>
            <Divider />
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                Событий пока нет.
              </Typography>
            ) : (
              <List dense disablePadding>
                {items.map((item) => (
                  <ListItem key={item.id} sx={{ px: 2, py: 0.75, alignItems: 'flex-start' }}>
                    <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {auditActionLabel(item.action)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatAuditTime(item.created_at)} · {auditActorLabel(item)}
                        {auditSourceLabel(item) ? ` · ${auditSourceLabel(item)}` : ''}
                      </Typography>
                    </Stack>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
