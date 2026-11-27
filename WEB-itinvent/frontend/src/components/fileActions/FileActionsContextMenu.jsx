import { useCallback, useEffect, useRef, useState } from 'react';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import FileCopyOutlinedIcon from '@mui/icons-material/FileCopyOutlined';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import PrintRoundedIcon from '@mui/icons-material/PrintRounded';
import SelectAllRoundedIcon from '@mui/icons-material/SelectAllRounded';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem } from '@mui/material';

import NestedMenuItem, { SUBMENU_SWITCH_DELAY_MS } from './NestedMenuItem';
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

// Photos open in the Windows viewer but never print through this channel and
// keep their Mark of the Web in the shell. They require file-actions-v3.
export const DESKTOP_PHOTO_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp',
]);

// Plain-text formats open in the Windows editor (Notepad or the associated
// viewer) but never print through this channel. The set mirrors the shell
// allowlist exactly and deliberately excludes script-like extensions
// (ps1/bat/cmd/sh/js/...): opening those can execute code.
export const DESKTOP_TEXT_OPEN_EXTENSIONS = new Set([
  'txt', 'log', 'md', 'markdown', 'json', 'xml',
  'yaml', 'yml', 'ini', 'cfg', 'conf', 'properties',
  'diff', 'patch', 'sql', 'toml',
]);

export function canOpenInDesktopApplication(fileName, { allowPhotos = false } = {}) {
  const normalized = String(fileName || '').trim().toLowerCase();
  const extension = normalized.includes('.') ? normalized.split('.').pop() : '';
  if (!extension) return false;
  if (DESKTOP_APPLICATION_EXTENSIONS.has(extension)) return true;
  if (DESKTOP_TEXT_OPEN_EXTENSIONS.has(extension)) return true;
  return Boolean(allowPhotos && DESKTOP_PHOTO_EXTENSIONS.has(extension));
}

// Printing is a separate capability: the Windows shell prints office
// documents through their associated application, but photos never enter the
// print channel even though they can be opened.
export function canPrintInDesktopApplication(fileName) {
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
  downloadRef = '',
  allowPhotoOpen = false,
  canDownload = true,
  busy = false,
  paperSx = null,
  onClose,
  onDetails,
  onPreview,
  onEditOnline,
  editOnlineLabel = 'Редактировать онлайн',
  onCollaborators,
  onVersions,
  onDownload,
  onExportPdf,
  onSaveAll,
  onRename,
  onMove,
  onCopyTo,
  onDelete,
  deleteLabel = 'Удалить',
  onSelectAll,
  onToggleFavorite,
  isFavorite = false,
  onShare,
  onRevokeShare,
  isShared = false,
  onAudit,
}) {
  const [requestingAction, setRequestingAction] = useState('');
  const [openIntentMessage, setOpenIntentMessage] = useState('');
  const [openSubmenu, setOpenSubmenu] = useState('');
  const submenuCloseTimer = useRef(null);
  const nativeShell = isNativeShellRuntime();
  const nativeFileActions = nativeShell && isDesktopCapabilityAvailable('file-actions-v2');
  // Photo opening is a chat-only action: other surfaces (mail, tasks, My
  // Files) keep the office/pdf set they had before. It also requires the v4
  // shell, which binds intents to the exact download and keeps photos out of
  // the print channel.
  const photoOpenAllowed = Boolean(
    allowPhotoOpen && isDesktopCapabilityAvailable('file-actions-v4'),
  );
  const canOpenInApplication = Boolean(
    canDownload
    && nativeShell
    && canOpenInDesktopApplication(fileName, { allowPhotos: photoOpenAllowed }),
  );
  const canPrintInApplication = Boolean(
    canDownload
    && nativeFileActions
    && canPrintInDesktopApplication(fileName),
  );
  const canCopyFile = Boolean(canDownload && nativeFileActions);

  useEffect(() => {
    if (!open) {
      setRequestingAction('');
      setOpenIntentMessage('');
      setOpenSubmenu('');
      clearTimeout(submenuCloseTimer.current);
      submenuCloseTimer.current = null;
    }
  }, [fileName, open]);

  // Hovering a plain (leaf) row while a flyout is open closes it — with the
  // same intent delay, so a diagonal pointer path into the flyout survives.
  const cancelSubmenuClose = useCallback(() => {
    clearTimeout(submenuCloseTimer.current);
    submenuCloseTimer.current = null;
  }, []);
  const scheduleSubmenuClose = useCallback(() => {
    cancelSubmenuClose();
    submenuCloseTimer.current = setTimeout(() => {
      submenuCloseTimer.current = null;
      setOpenSubmenu('');
    }, SUBMENU_SWITCH_DELAY_MS);
  }, [cancelSubmenuClose]);

  const runDownload = async (action = '') => {
    if (action) {
      setRequestingAction(action);
      setOpenIntentMessage('');
      const result = await requestDesktopDownloadedFileAction(action, fileName, downloadRef);
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

  // `topLevel` marks rows of the parent menu: hovering one schedules the open
  // flyout's close. Rows inside a flyout keep it (and its parent) alone.
  const leaf = (key, testId, disabled, onClick, icon, text, sx = null, topLevel = false) => (
    <MenuItem
      key={key}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={topLevel ? scheduleSubmenuClose : undefined}
      onMouseLeave={topLevel ? cancelSubmenuClose : undefined}
      sx={{ minHeight: 40, ...(sx || {}) }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText>{text}</ListItemText>
    </MenuItem>
  );

  const shareItems = [
    typeof onCollaborators === 'function'
      ? leaf('collaborators', 'file-action-collaborators', actionBusy, () => runDirectAction(onCollaborators),
        <GroupAddOutlinedIcon fontSize="small" />, 'Совместный доступ')
      : null,
    typeof onShare === 'function'
      ? leaf('share', 'file-action-share', actionBusy, () => runDirectAction(onShare),
        <ShareOutlinedIcon fontSize="small" />, isShared ? 'Копировать ссылку' : 'Поделиться ссылкой')
      : null,
    typeof onRevokeShare === 'function'
      ? leaf('revoke-share', 'file-action-revoke-share', actionBusy, () => runDirectAction(onRevokeShare),
        <LinkOutlinedIcon fontSize="small" />, 'Отключить ссылку')
      : null,
  ].filter(Boolean);

  const organizeItems = [
    typeof onToggleFavorite === 'function'
      ? leaf('favorite', 'file-action-favorite', actionBusy, () => runDirectAction(onToggleFavorite),
        isFavorite
          ? <StarRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
          : <StarOutlineRoundedIcon fontSize="small" />,
        isFavorite ? 'Убрать из избранного' : 'В избранное')
      : null,
    typeof onRename === 'function'
      ? leaf('rename', 'file-action-rename', actionBusy, () => runDirectAction(onRename),
        <DriveFileRenameOutlineRoundedIcon fontSize="small" />, 'Переименовать')
      : null,
    typeof onMove === 'function'
      ? leaf('move', 'file-action-move', actionBusy, () => runDirectAction(onMove),
        <DriveFileMoveOutlinedIcon fontSize="small" />, 'Переместить')
      : null,
    typeof onCopyTo === 'function'
      ? leaf('copy-to', 'file-action-copy-to', actionBusy, () => runDirectAction(onCopyTo),
        <FileCopyOutlinedIcon fontSize="small" />, 'Копировать в…')
      : null,
    canCopyFile
      ? leaf('copy', 'file-action-copy', actionBusy, () => runDownload('copy'),
        <ContentCopyRoundedIcon fontSize="small" />, 'Копировать')
      : null,
    typeof onSelectAll === 'function'
      ? leaf('select-all', 'file-action-select-all', actionBusy, () => runDirectAction(onSelectAll),
        <SelectAllRoundedIcon fontSize="small" />, 'Выделить все')
      : null,
  ].filter(Boolean);

  const moreItems = [
    typeof onDetails === 'function'
      ? leaf('details', 'file-action-details', actionBusy, () => runDirectAction(onDetails),
        <InfoOutlinedIcon fontSize="small" />, 'Сведения')
      : null,
    typeof onVersions === 'function'
      ? leaf('versions', 'file-action-versions', actionBusy, () => runDirectAction(onVersions),
        <RestoreRoundedIcon fontSize="small" />, 'Предыдущие версии')
      : null,
    typeof onAudit === 'function'
      ? leaf('audit', 'file-action-audit', actionBusy, () => runDirectAction(onAudit),
        <HistoryRoundedIcon fontSize="small" />, 'Журнал')
      : null,
    canPrintInApplication
      ? leaf('quick-print', 'file-action-quick-print', actionBusy, () => runDownload('print'),
        <PrintRoundedIcon fontSize="small" />, 'Быстрая печать')
      : null,
    typeof onExportPdf === 'function'
      ? leaf('export-pdf', 'file-action-export-pdf', actionBusy, () => runDirectAction(onExportPdf),
        <PictureAsPdfRoundedIcon fontSize="small" />, 'Скачать как PDF')
      : null,
    typeof onSaveAll === 'function'
      ? leaf('save-all', 'file-action-save-all', actionBusy, () => runDirectAction(onSaveAll),
        <DownloadRoundedIcon fontSize="small" />, 'Сохранить все вложения…')
      : null,
  ].filter(Boolean);

  const group = (id, label, icon, items) => {
    if (items.length === 0) return null;
    if (items.length === 1) return items[0];
    return (
      <NestedMenuItem
        key={id}
        id={id}
        openSubmenu={openSubmenu}
        onOpenSubmenu={setOpenSubmenu}
        onSubmenuEnter={cancelSubmenuClose}
        label={label}
        icon={icon}
        disabled={actionBusy}
        testId={`file-action-group-${id}`}
      >
        {items}
      </NestedMenuItem>
    );
  };

  return (
    <Menu
      open={Boolean(open)}
      onClose={onClose}
      anchorEl={anchorEl}
      anchorReference={anchorPosition ? 'anchorPosition' : 'anchorEl'}
      anchorPosition={anchorPosition || undefined}
      MenuListProps={{ 'aria-label': `Действия с файлом ${fileName || 'файл'}` }}
      // Отключение scroll-lock устраняет форсированный рефлоу всего документа
      // (~600мс longtask на больших списках) при открытии меню; прецедент —
      // ChatMessageContextMenu и flyout NestedMenuItem.
      disableScrollLock
      PaperProps={{
        sx: {
          minWidth: 220,
          borderRadius: '10px',
          boxShadow: '0 14px 36px rgba(2, 6, 23, 0.24)',
          ...(paperSx || {}),
        },
      }}
    >
      {typeof onPreview === 'function' ? leaf('preview', 'file-action-preview', actionBusy,
        () => runDirectAction(onPreview), <VisibilityOutlinedIcon fontSize="small" />, 'Просмотр', null, true) : null}
      {canOpenInApplication ? leaf('open-in-application', 'file-action-open-in-application', actionBusy,
        () => runDownload('open'), <OpenInNewRoundedIcon fontSize="small" />, 'Открыть', null, true) : null}
      {typeof onEditOnline === 'function' ? leaf('edit-online', 'file-action-edit-online', actionBusy,
        () => runDirectAction(onEditOnline), <EditNoteRoundedIcon fontSize="small" />, editOnlineLabel, null, true) : null}
      {typeof onDownload === 'function' ? leaf('download', 'file-action-download', !canDownload || actionBusy,
        () => runDownload(nativeFileActions ? 'saveAs' : ''),
        <DownloadRoundedIcon fontSize="small" />, nativeFileActions ? 'Сохранить как' : 'Скачать', null, true) : null}
      {group('share', 'Поделиться', <ShareOutlinedIcon fontSize="small" />, shareItems)}
      {group('organize', 'Организовать', <DriveFileMoveOutlinedIcon fontSize="small" />, organizeItems)}
      {group('more', 'Дополнительно', <MoreHorizRoundedIcon fontSize="small" />, moreItems)}
      {openIntentMessage ? (
        <ListSubheader
          role="status"
          aria-live="polite"
          sx={{ maxWidth: 280, py: 0.75, lineHeight: 1.35, whiteSpace: 'normal' }}
        >
          {openIntentMessage}
        </ListSubheader>
      ) : null}
      {typeof onDelete === 'function' ? <Divider /> : null}
      {typeof onDelete === 'function' ? (
        <MenuItem
          data-testid="file-action-delete"
          disabled={actionBusy}
          onClick={() => runDirectAction(onDelete)}
          onMouseEnter={scheduleSubmenuClose}
          onMouseLeave={cancelSubmenuClose}
          sx={{ minHeight: 40, color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{deleteLabel}</ListItemText>
        </MenuItem>
      ) : null}
    </Menu>
  );
}
