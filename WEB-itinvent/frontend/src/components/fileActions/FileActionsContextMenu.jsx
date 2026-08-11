import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';

import { requestDesktopOpenDownloadedFile } from '../../lib/desktopBridge';
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
  onDownload,
}) {
  const canOpenInApplication = Boolean(
    canDownload
    && isNativeShellRuntime()
    && canOpenInDesktopApplication(fileName),
  );

  const runDownload = (openInApplication = false) => {
    onClose?.();
    if (openInApplication && !requestDesktopOpenDownloadedFile()) return;
    onDownload?.();
  };

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
      {canOpenInApplication ? (
        <MenuItem
          data-testid="file-action-open-in-application"
          disabled={busy}
          onClick={() => runDownload(true)}
          sx={{ minHeight: 40 }}
        >
          <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Открыть в приложении</ListItemText>
        </MenuItem>
      ) : null}
      <MenuItem
        data-testid="file-action-download"
        disabled={!canDownload || busy}
        onClick={() => runDownload(false)}
        sx={{ minHeight: 40 }}
      >
        <ListItemIcon><DownloadRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Скачать</ListItemText>
      </MenuItem>
    </Menu>
  );
}
