import { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded';

import useAiSandboxConversation from './useAiSandboxConversation';

const text = (value) => String(value ?? '').trim();

const statusLabel = (value) => ({
  preparing: 'Подготовка',
  queued: 'В очереди',
  claimed: 'Запускается',
  running: 'Выполняется',
  waiting_permission: 'Нужно разрешение',
  succeeded: 'Готово',
  completed: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Остановлено',
  expired: 'Время истекло',
}[text(value).toLowerCase()] || text(value) || 'Ожидает запуска');

const normalizeDownloadUrl = (value) => {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const resolved = new URL(candidate, origin);
    if (resolved.origin !== origin || !['http:', 'https:'].includes(resolved.protocol)) return '';
    return candidate.startsWith('/') ? `${resolved.pathname}${resolved.search}${resolved.hash}` : resolved.href;
  } catch {
    return '';
  }
};

const collectDiffEntries = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [{ diff: value }];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.files)) return value.files;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.entries)) return value.entries;
  return Object.keys(value).length > 0 ? [value] : [];
};

const attachmentReference = (item) => ({
  messageId: text(item?.message_id || item?.messageId || item?.attachment?.message_id),
  attachmentId: text(item?.attachment_id || item?.attachmentId || item?.attachment?.id),
});

const fileName = (item) => text(item?.path || item?.relative_path || item?.name || item?.file_name) || 'Файл';

export default function OpenCodeConversationContext({ conversationId, refreshKey = '' }) {
  const sandbox = useAiSandboxConversation({ available: true, conversationId, refreshKey });
  const diffEntries = useMemo(() => collectDiffEntries(sandbox.diff), [sandbox.diff]);

  return (
    <Stack spacing={1.5} sx={{ py: 2 }} data-testid="opencode-conversation-context">
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
          <CodeRoundedIcon color="action" fontSize="small" />
          <Typography variant="overline" color="text.secondary" fontWeight={800}>
            OpenCode workspace
          </Typography>
        </Stack>
        {sandbox.job ? <Chip size="small" label={statusLabel(sandbox.job.status)} /> : null}
      </Stack>

      {sandbox.loading ? (
        <Stack direction="row" alignItems="center" gap={1} role="status" sx={{ minHeight: 44 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Загружаю workspace…</Typography>
        </Stack>
      ) : null}
      {sandbox.error ? <Alert severity="error">{sandbox.error}</Alert> : null}
      {sandbox.notice ? <Alert severity="success" onClose={sandbox.dismissNotice}>{sandbox.notice}</Alert> : null}
      {!sandbox.loading && !sandbox.enabled ? (
        <Alert severity="info">OpenCode сейчас отключён для этого диалога.</Alert>
      ) : null}

      {sandbox.enabled && sandbox.pendingPermissions.length > 0 ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2" fontWeight={800}>Запросы разрешений</Typography>
          {sandbox.pendingPermissions.map((permission) => {
            const permissionId = text(permission?.id || permission?.permission_id);
            const permissionBusy = sandbox.busyKey === `permission:${permissionId}`;
            const permissionTitle = text(permission?.title || permission?.tool_label || permission?.tool || permission?.kind)
              || 'Действие OpenCode';
            const permissionDetail = text(
              permission?.description
              || permission?.reason
              || permission?.summary
              || permission?.operation
              || permission?.command
              || permission?.path,
            );
            const permissionArguments = permission?.arguments && typeof permission.arguments === 'object'
              ? JSON.stringify(permission.arguments, null, 2)
              : '';
            return (
              <Box key={permissionId || permissionTitle} sx={{ p: 1.25, border: 1, borderColor: 'warning.main', borderRadius: 2 }}>
                <Typography variant="body2" fontWeight={800}>{permissionTitle}</Typography>
                {permissionDetail ? (
                  <Typography component="pre" variant="caption" sx={{ mt: 0.5, mb: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
                    {permissionDetail}
                  </Typography>
                ) : null}
                {permissionArguments && permissionArguments !== '{}' ? (
                  <Typography component="pre" variant="caption" sx={{ mt: 0.5, mb: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
                    {permissionArguments}
                  </Typography>
                ) : null}
                <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
                  <Button
                    color="inherit"
                    startIcon={<BlockRoundedIcon />}
                    disabled={permissionBusy}
                    onClick={() => void sandbox.respondPermission(permission, 'reject', 'once')}
                    sx={{ minHeight: 44 }}
                  >
                    Отклонить
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={permissionBusy}
                    onClick={() => void sandbox.respondPermission(permission, 'allow', 'once')}
                    sx={{ minHeight: 44 }}
                  >
                    Разрешить один раз
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={permissionBusy}
                    onClick={() => void sandbox.respondPermission(permission, 'allow', 'session')}
                    sx={{ minHeight: 44 }}
                  >
                    До конца сессии
                  </Button>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      ) : null}

      {sandbox.enabled ? (
        <>
          <Divider />
          <Stack spacing={0.75}>
            <Stack direction="row" alignItems="center" gap={1}>
              <FolderOpenRoundedIcon color="action" fontSize="small" />
              <Typography variant="subtitle2" fontWeight={800}>Файлы workspace</Typography>
            </Stack>
            {sandbox.files.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Файлов пока нет.</Typography>
            ) : sandbox.files.map((file) => {
              const id = text(file?.id || file?.file_id);
              const path = fileName(file);
              const depth = Math.min((path.match(/\//gu) || []).length, 4);
              const downloadUrl = normalizeDownloadUrl(file?.download_url || file?.url);
              const changed = Boolean(file?.changed) || ['added', 'modified', 'deleted'].includes(text(file?.status).toLowerCase());
              const availability = text(file?.availability).toLowerCase();
              const deliveryPending = availability === 'pending';
              const deliveryUnavailable = availability === 'unavailable';
              const deliveryReady = !availability || ['attached', 'not_applicable'].includes(availability);
              const canAttach = deliveryReady
                && ['output', 'changed', 'archive'].includes(text(file?.kind).toLowerCase());
              const { messageId, attachmentId } = attachmentReference(file);
              return (
                <Box key={id || path} sx={{ ml: depth * 1.25, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                  <Stack direction="row" alignItems="center" gap={0.75}>
                    <Typography variant="body2" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{path}</Typography>
                    {changed ? <Chip size="small" color="warning" variant="outlined" label="Изменён" /> : null}
                    {deliveryPending ? <Chip size="small" color="info" variant="outlined" label="Проверяется" /> : null}
                    {deliveryUnavailable ? <Chip size="small" color="error" variant="outlined" label="Недоступен" /> : null}
                  </Stack>
                  <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                    {deliveryReady && downloadUrl ? (
                      <Button component="a" href={downloadUrl} download startIcon={<DownloadRoundedIcon />} sx={{ minHeight: 44 }}>
                        Скачать
                      </Button>
                    ) : null}
                    {id && ['output', 'changed', 'archive'].includes(text(file?.kind).toLowerCase()) ? (
                      <Button
                        startIcon={<AttachFileRoundedIcon />}
                        disabled={!canAttach || sandbox.busyKey === `attach:${id}`}
                        onClick={() => void sandbox.attachFile(file)}
                        sx={{ minHeight: 44 }}
                      >
                        Прикрепить
                      </Button>
                    ) : null}
                    {deliveryReady && messageId && attachmentId ? (
                      <Button
                        startIcon={<PlaylistAddCheckRoundedIcon />}
                        disabled={sandbox.busyKey === `save:${id || attachmentId}`}
                        onClick={() => void sandbox.saveToMyFiles(file)}
                        sx={{ minHeight: 44 }}
                      >
                        Сохранить в Мои файлы
                      </Button>
                    ) : null}
                  </Stack>
                </Box>
              );
            })}
          </Stack>

          <Divider />
          <Stack spacing={0.75}>
            <Typography variant="subtitle2" fontWeight={800}>Изменения</Typography>
            {diffEntries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Изменений пока нет.</Typography>
            ) : diffEntries.map((entry, index) => {
              const path = fileName(entry);
              const patch = text(entry?.diff || entry?.patch || entry?.content || entry?.text);
              return (
                <Box key={`${path}:${index}`} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                  <Typography variant="caption" fontWeight={800} sx={{ display: 'block', px: 1, py: 0.75, bgcolor: 'action.hover', overflowWrap: 'anywhere' }}>
                    {path}
                  </Typography>
                  {patch ? (
                    <Typography component="pre" variant="caption" sx={{ m: 0, p: 1, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
                      {patch}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </Stack>

          {sandbox.session ? (
            <>
              <Divider />
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75}>
                {normalizeDownloadUrl(sandbox.archive?.download_url || sandbox.archive?.url) ? (
                  <Button
                    component="a"
                    href={normalizeDownloadUrl(sandbox.archive?.download_url || sandbox.archive?.url)}
                    download
                    startIcon={<DownloadRoundedIcon />}
                    sx={{ minHeight: 44 }}
                  >
                    Скачать архив
                  </Button>
                ) : null}
                <Button
                  startIcon={<AttachFileRoundedIcon />}
                  disabled={sandbox.busyKey === 'attach:archive'}
                  onClick={() => void sandbox.attachArchive()}
                  sx={{ minHeight: 44 }}
                >
                  Прикрепить архив
                </Button>
                {attachmentReference(sandbox.archive).messageId && attachmentReference(sandbox.archive).attachmentId ? (
                  <Button
                    startIcon={<PlaylistAddCheckRoundedIcon />}
                    disabled={sandbox.busyKey === `save:${text(sandbox.archive.id) || attachmentReference(sandbox.archive).attachmentId}`}
                    onClick={() => void sandbox.saveToMyFiles(sandbox.archive, 'archive')}
                    sx={{ minHeight: 44 }}
                  >
                    Сохранить архив в Мои файлы
                  </Button>
                ) : null}
              </Stack>
            </>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
