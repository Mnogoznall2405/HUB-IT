import { useEffect, useState } from 'react';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import SelectAllRoundedIcon from '@mui/icons-material/SelectAllRounded';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem } from '@mui/material';

import {
  isDesktopCapabilityAvailable,
  requestDesktopDownloadedFileAction,
} from '../../lib/desktopBridge';
import { isNativeShellRuntime } from '../../lib/platform';

const DESKTOP_APPLICATION_EXTENSIONS = new Set([
  'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm',
  'xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm',
  'odt', 'ods', 'odp', 'rtf', 'csv', 'pdf',
]);

export function canOpenInDesktopApplication(fileName) {
  const normalized = String(fileName || '').trim().toLowerCase();
  const extension = normalized.includes('.') ? normalized.split('.').pop() : '';
  return Boolean(extension && DESKTOP_APPLICATION_EXTENSIONS.has(extension));
}

export function isFileActionsKeyboardShortcut(event) {
  return event?.key === 'ContextMenu' || (event?.shiftKey && event?.key === 'F10');
}

export function getFileActionsAnchorPosition(event) {
  const clientX = Number(event?.clientX || 0);
  const clientY = Number(event?.clientY || 0);
  if (clientX > 0 || clientY > 0) {
    return { left: clientX, top: clientY };
  }

  const rect = event?.currentTarget?.getBoundingClientRect?.();
  return {
    left: Math.round((rect?.left || 0) + Math.min(rect?.width || 0, 32)),
    top: Math.round((rect?.top || 0) + Math.min(rect?.height || 0, 32)),
  };
}

export default function FileActionsContextMenu({
  open = false,
  anchorEl = null,
  anchorPosition = null,
  fileName = '',
  canDownload = true,
  busy = false,
  paperSx = null,
  onClose,
  onPreview,
  onDownload,
  onSaveAll,
  onDelete,
  onSelectAll,
}) {
  const [requestingAction, setRequestingAction] = useState('');
  const [openIntentMessage, setOpenIntentMessage] = useState('');
  const nativeShell = isNativeShellRuntime();
  const nativeFileActions = nativeShell && isDesktopCapabilityAvailable('file-actions-v2');
  const canOpenInApplication = Boolean(
    canDownload
    && nativeShell
    && canOpenInDesktopApplication(fileName),
  );
  const canPrintInApplication = canOpenInApplication && nativeFileActions;
  const canCopyFile = Boolean(canDownload && nativeFileActions);

  useEffect(() => {
    if (!open) {
      setRequestingAction('');
      setOpenIntentMessage('');
    }
  }, [fileName, open]);

  const runDownload = async (action = '') => {
    if (action) {
      setRequestingAction(action);
      setOpenIntentMessage('');
      const result = await requestDesktopDownloadedFileAction(action);
      setRequestingAction('');
      if (!result.accepted) {
        setOpenIntentMessage(
          result.status === 'busy'
            ? 'Дождитесь завершения текущей загрузки и повторите действие'
            : 'Не удалось выполнить действие. Повторите попытку',
        );
        return;
      }
    }

    onClose?.();
    onDownload?.();
  };

  const runDirectAction = (action) => {
    onClose?.();
    action?.();
  };

  const actionBusy = Boolean(busy || requestingAction);

  return (
    <Menu
      open={Boolean(open)}
      onClose={onClose}
      anchorEl={anchorEl}
      anchorReference={anchorPosition ? 'anchorPosition' : 'anchorEl'}
      anchorPosition={anchorPosition || undefined}
      MenuListProps={{ 'aria-label': `Действия с файлом ${fileName || 'файл'}` }}
      PaperProps={{
        sx: {
          minWidth: 220,
          borderRadius: '10px',
          boxShadow: '0 14px 36px rgba(2, 6, 23, 0.24)',
          ...(paperSx || {}),
        },
      }}
    >
      {typeof onPreview === 'function' ? (
        <MenuItem
          data-testid="file-action-preview"
          disabled={actionBusy}
          onClick={() => runDirectAction(onPreview)}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><VisibilityOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Просмотр</ListItemText>
        </MenuItem>
      ) : null}
      {canOpenInApplication ? (
        <MenuItem
          data-testid="file-action-open-in-application"
          disabled={actionBusy}
          onClick={() => runDownload('open')}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Открыть</ListItemText>
        </MenuItem>
      ) : null}
      {canPrintInApplication ? (
        <MenuItem
          data-testid="file-action-quick-print"
          disabled={actionBusy}
          onClick={() => runDownload('print')}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><PrintRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Быстрая печать</ListItemText>
        </MenuItem>
      ) : null}
      {openIntentMessage ? (
        <ListSubheader
          role="status"
          aria-live="polite"
          sx={{ maxWidth: 280, py: 0.75, lineHeight: 1.35, whiteSpace: 'normal' }}
        >
          {openIntentMessage}
        </ListSubheader>
      ) : null}
      {typeof onDownload === 'function' ? (
        <MenuItem
          data-testid="file-action-download"
          disabled={!canDownload || actionBusy}
          onClick={() => runDownload(nativeFileActions ? 'saveAs' : '')}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><DownloadRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{nativeFileActions ? 'Сохранить как' : 'Скачать'}</ListItemText>
        </MenuItem>
      ) : null}
      {typeof onSaveAll === 'function' ? (
        <MenuItem
          data-testid="file-action-save-all"
          disabled={actionBusy}
          onClick={() => runDirectAction(onSaveAll)}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><DownloadRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Сохранить все вложения…</ListItemText>
        </MenuItem>
      ) : null}
      {canCopyFile || typeof onDelete === 'function' || typeof onSelectAll === 'function' ? <Divider /> : null}
      {canCopyFile ? (
        <MenuItem
          data-testid="file-action-copy"
          disabled={actionBusy}
          onClick={() => runDownload('copy')}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><ContentCopyRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Копировать</ListItemText>
        </MenuItem>
      ) : null}
      {typeof onDelete === 'function' ? (
        <MenuItem
          data-testid="file-action-delete"
          disabled={actionBusy}
          onClick={() => runDirectAction(onDelete)}
          sx={{ minHeight: 40, color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Удалить вложение</ListItemText>
        </MenuItem>
      ) : null}
      {typeof onSelectAll === 'function' ? (
        <MenuItem
          data-testid="file-action-select-all"
          disabled={actionBusy}
          onClick={() => runDirectAction(onSelectAll)}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><SelectAllRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Выделить все</ListItemText>
        </MenuItem>
      ) : null}
    </Menu>
  );
}
