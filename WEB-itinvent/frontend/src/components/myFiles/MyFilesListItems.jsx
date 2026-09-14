import { memo } from 'react';
import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import RestoreOutlinedIcon from '@mui/icons-material/RestoreOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';

import { isFileActionsKeyboardShortcut } from '../fileActions/FileActionsContextMenu';
import { formatFileSize, isMyFilePreviewSupported } from '../../lib/myFilesPreview';
import {
  formatDateTime,
  getFileVisualColors,
  getFileVisualMeta,
  READY_STATUSES,
  ROW_ACTIONS_SX,
  statusChip,
  VIRTUALIZED_CARD_SX,
  VIRTUALIZED_ROW_SX,
} from './myFilesVisual';
export const FolderRow = memo(function FolderRow({
  folder,
  isTrashView,
  canWrite,
  canShare,
  isSelected,
  isDropTarget,
  folderDropProps,
  navigateToFolder,
  openFolderActionsMenu,
  openRenameDialog,
  handleFolderShare,
  handleDeleteFolder,
  handleRestoreEntry,
  handlePurgeEntry,
  onToggleFavorite,
  toggleSelected,
}) {
  const theme = useTheme();
  const folderColors = getFileVisualColors(theme, { palette: 'warning' });
  const rowKey = `folder:${folder.id}`;
  return (
    <Box
      data-testid={`my-files-folder-${folder.id}`}
      {...(isTrashView ? {} : folderDropProps(folder))}
      onClick={() => { if (!isTrashView) navigateToFolder(folder.id); }}
      onContextMenu={(event) => { if (!isTrashView) openFolderActionsMenu(event, folder); }}
      onKeyDown={(event) => {
        if (isTrashView) return;
        if (event.key === 'Enter') navigateToFolder(folder.id);
        if (isFileActionsKeyboardShortcut(event)) openFolderActionsMenu(event, folder);
      }}
      tabIndex={0}
      sx={{
        ...VIRTUALIZED_ROW_SX,
        display: 'grid',
        gridTemplateColumns: isTrashView
          ? { xs: 'minmax(0,1fr) auto', md: 'minmax(0,1fr) 170px 110px 176px' }
          : { xs: '40px minmax(0,1fr) auto', md: '40px minmax(0,1fr) 170px 110px 176px' },
        gap: 1,
        alignItems: 'center',
        px: 1,
        py: 0.5,
        cursor: isTrashView ? 'default' : 'pointer',
        borderBottom: `1px solid ${theme.palette.divider}`,
        bgcolor: isDropTarget
          ? alpha(theme.palette.primary.main, 0.16)
          : isSelected ? 'action.selected' : 'transparent',
        outline: isDropTarget ? `2px dashed ${theme.palette.primary.main}` : 'none',
        outlineOffset: -2,
        transition: 'background-color 0.15s ease',
        '&:hover': { bgcolor: 'action.hover' },
        '&:hover .row-actions': { opacity: 1 },
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      }}
    >
      {isTrashView ? null : (
        <Checkbox
          size="small"
          checked={isSelected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleSelected(rowKey)}
          inputProps={{ 'aria-label': `Выбрать папку ${folder.name}` }}
        />
      )}
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            flex: '0 0 auto',
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            color: folderColors.color,
            bgcolor: folderColors.background,
          }}
        >
          <FolderOutlinedIcon sx={{ fontSize: 20 }} />
        </Box>
        <Typography
          variant="body2"
          title={folder.name}
          sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {folder.name}
        </Typography>
        {folder.is_favorite ? <StarRoundedIcon sx={{ fontSize: 15, color: 'warning.main', flex: '0 0 auto' }} /> : null}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
        {formatDateTime(folder.updated_at)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
        {Number(folder.file_count || 0) > 0 ? `${folder.file_count} шт.` : '—'}
      </Typography>
      <Box className="row-actions" sx={ROW_ACTIONS_SX}>
        {isTrashView ? (
          <>
            <Tooltip title="Восстановить">
              <IconButton
                size="small"
                disabled={!canWrite}
                aria-label={`Восстановить папку ${folder.name}`}
                data-testid={`my-files-restore-folder-${folder.id}`}
                onClick={(event) => { event.stopPropagation(); void handleRestoreEntry('folder', folder.id); }}
              >
                <RestoreOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Удалить навсегда">
              <IconButton
                size="small"
                color="error"
                disabled={!canWrite}
                aria-label={`Удалить навсегда папку ${folder.name}`}
                data-testid={`my-files-purge-folder-${folder.id}`}
                onClick={(event) => { event.stopPropagation(); void handlePurgeEntry('folder', folder.id, folder.name); }}
              >
                <DeleteForeverOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip title="Открыть">
              <IconButton
                size="small"
                aria-label={`Открыть папку ${folder.name}`}
                onClick={(event) => { event.stopPropagation(); navigateToFolder(folder.id); }}
              >
                <FolderOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={folder.is_favorite ? 'Убрать из избранного' : 'В избранное'}>
              <IconButton
                size="small"
                disabled={!canWrite}
                aria-label={folder.is_favorite ? `Убрать «${folder.name}» из избранного` : `Добавить «${folder.name}» в избранное`}
                data-testid={`my-files-favorite-folder-${folder.id}`}
                onClick={(event) => { event.stopPropagation(); void onToggleFavorite(folder, 'folder'); }}
              >
                {folder.is_favorite
                  ? <StarRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
                  : <StarOutlineRoundedIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Поделиться папкой">
              <IconButton
                size="small"
                disabled={!canShare}
                aria-label={`Поделиться папкой ${folder.name}`}
                data-testid={`my-files-share-folder-${folder.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleFolderShare(folder);
                }}
              >
                <ShareOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Переименовать">
              <IconButton
                size="small"
                disabled={!canWrite}
                aria-label={`Переименовать папку ${folder.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openRenameDialog('folder', folder.id, folder.name);
                }}
              >
                <DriveFileRenameOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Удалить">
              <IconButton
                size="small"
                color="error"
                disabled={!canWrite}
                aria-label={`Удалить папку ${folder.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDeleteFolder(folder);
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
    </Box>
  );
});

export const FileRow = memo(function FileRow({
  item,
  isTrashView,
  canWrite,
  canShare,
  isSelected,
  downloading,
  fileDragProps,
  openDocumentPreview,
  openFileActionsMenu,
  handleRestoreEntry,
  handlePurgeEntry,
  handleDownload,
  handleShare,
  handleDelete,
  onToggleFavorite,
  toggleSelected,
}) {
  const theme = useTheme();
  const chip = statusChip(item.status, item.error_text);
  const ready = READY_STATUSES.has(String(item.status || '').toLowerCase());
  const previewSupported = ready && isMyFilePreviewSupported(item);
  const meta = getFileVisualMeta(item);
  const Icon = meta.icon;
  const colors = getFileVisualColors(theme, meta);
  const fileName = item.original_file_name || item.download_file_name || 'file.bin';
  const rowKey = `file:${item.id}`;
  return (
    <Box
      data-testid={`my-files-card-${item.id}`}
      {...(isTrashView ? {} : fileDragProps(item))}
      onClick={() => { if (!isTrashView && previewSupported) void openDocumentPreview(item); }}
      onContextMenu={(event) => { if (!isTrashView) openFileActionsMenu(event, item); }}
      onKeyDown={(event) => {
        if (isTrashView) return;
        if (event.key === 'Enter') {
          if (previewSupported) void openDocumentPreview(item);
          else openFileActionsMenu(event, item);
        }
        if (isFileActionsKeyboardShortcut(event)) openFileActionsMenu(event, item);
      }}
      tabIndex={0}
      sx={{
        ...VIRTUALIZED_ROW_SX,
        display: 'grid',
        gridTemplateColumns: isTrashView
          ? { xs: 'minmax(0,1fr) auto', md: 'minmax(0,1fr) 170px 110px 176px' }
          : { xs: '40px minmax(0,1fr) auto', md: '40px minmax(0,1fr) 170px 110px 176px' },
        gap: 1,
        alignItems: 'center',
        px: 1,
        py: 0.5,
        cursor: !isTrashView && previewSupported ? 'pointer' : 'default',
        borderBottom: `1px solid ${theme.palette.divider}`,
        bgcolor: isSelected ? 'action.selected' : 'transparent',
        transition: 'background-color 0.15s ease',
        '&:hover': { bgcolor: 'action.hover' },
        '&:hover .row-actions': { opacity: 1 },
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      }}
    >
      {isTrashView ? null : (
        <Checkbox
          size="small"
          checked={isSelected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleSelected(rowKey)}
          inputProps={{ 'aria-label': `Выбрать файл ${fileName}` }}
        />
      )}
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            flex: '0 0 auto',
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            color: colors.color,
            bgcolor: colors.background,
          }}
        >
          <Icon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              title={fileName}
              sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {fileName}
            </Typography>
            {item.is_favorite ? <StarRoundedIcon sx={{ fontSize: 15, color: 'warning.main', flex: '0 0 auto' }} /> : null}
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
            {String(item.status || '').toLowerCase() !== 'ready' ? (
              <Chip size="small" label={chip.label} color={chip.color} sx={{ height: 18, fontSize: '0.68rem' }} />
            ) : null}
            {item.is_shared ? (
              <Chip size="small" icon={<LinkOutlinedIcon sx={{ fontSize: 12 }} />} label="ссылка" variant="outlined" sx={{ height: 18, fontSize: '0.68rem' }} />
            ) : null}
            {item.folder_name ? (
              <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.folder_name}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
        {formatDateTime(item.updated_at || item.created_at)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
        {formatFileSize(item.original_size_bytes)}
      </Typography>
      <Box className="row-actions" sx={ROW_ACTIONS_SX}>
        {isTrashView ? (
          <>
            <Tooltip title="Восстановить">
              <IconButton
                size="small"
                disabled={!canWrite}
                aria-label={`Восстановить ${fileName}`}
                data-testid={`my-files-restore-${item.id}`}
                onClick={(event) => { event.stopPropagation(); void handleRestoreEntry('file', item.id); }}
              >
                <RestoreOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Удалить навсегда">
              <IconButton
                size="small"
                color="error"
                disabled={!canWrite}
                aria-label={`Удалить навсегда ${fileName}`}
                data-testid={`my-files-purge-${item.id}`}
                onClick={(event) => { event.stopPropagation(); void handlePurgeEntry('file', item.id, fileName); }}
              >
                <DeleteForeverOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip title={item.is_favorite ? 'Убрать из избранного' : 'В избранное'}>
              <span>
                <IconButton
                  size="small"
                  disabled={!canWrite}
                  aria-label={item.is_favorite ? `Убрать «${fileName}» из избранного` : `Добавить «${fileName}» в избранное`}
                  data-testid={`my-files-favorite-${item.id}`}
                  onClick={(event) => { event.stopPropagation(); void onToggleFavorite(item, 'file'); }}
                >
                  {item.is_favorite
                    ? <StarRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
                    : <StarOutlineRoundedIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={previewSupported ? 'Просмотреть' : 'Предпросмотр недоступен'}>
              <span>
                <IconButton
                  size="small"
                  data-testid={`my-files-preview-${item.id}`}
                  aria-label={`Просмотреть ${fileName}`}
                  disabled={!previewSupported}
                  onClick={(event) => { event.stopPropagation(); openDocumentPreview(item); }}
                >
                  <VisibilityOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Скачать">
              <span>
                <IconButton
                  size="small"
                  data-testid={`my-files-download-${item.id}`}
                  aria-label={`Скачать ${fileName}`}
                  disabled={!ready || downloading}
                  onClick={(event) => { event.stopPropagation(); void handleDownload(item); }}
                >
                  {downloading ? <CircularProgress size={18} /> : <DownloadOutlinedIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={item.is_shared ? 'Поделиться ссылкой' : 'Создать публичную ссылку'}>
              <span>
                <IconButton
                  size="small"
                  data-testid={`my-files-share-${item.id}`}
                  aria-label={`Поделиться ${fileName}`}
                  disabled={!ready || !canShare}
                  onClick={(event) => { event.stopPropagation(); void handleShare(item); }}
                >
                  <ShareOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Удалить">
              <span>
                <IconButton
                  size="small"
                  data-testid={`my-files-delete-${item.id}`}
                  aria-label={`Удалить ${fileName}`}
                  color="error"
                  disabled={!canWrite}
                  onClick={(event) => { event.stopPropagation(); void handleDelete(item); }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Box>
    </Box>
  );
});

export const FolderCard = memo(function FolderCard({
  folder,
  isTrashView,
  canWrite,
  isSelected,
  isDropTarget,
  folderDropProps,
  navigateToFolder,
  openFolderActionsMenu,
  handleRestoreEntry,
  handlePurgeEntry,
  onToggleFavorite,
  toggleSelected,
}) {
  const theme = useTheme();
  const rowKey = `folder:${folder.id}`;
  return (
    <Paper
      variant="outlined"
      data-testid={`my-files-folder-${folder.id}`}
      {...(isTrashView ? {} : folderDropProps(folder))}
      onClick={() => { if (!isTrashView) navigateToFolder(folder.id); }}
      onContextMenu={(event) => { if (!isTrashView) openFolderActionsMenu(event, folder); }}
      onKeyDown={(event) => {
        if (isTrashView) return;
        if (event.key === 'Enter') navigateToFolder(folder.id);
        if (isFileActionsKeyboardShortcut(event)) openFolderActionsMenu(event, folder);
      }}
      tabIndex={0}
      sx={{
        ...VIRTUALIZED_CARD_SX,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 1,
        cursor: isTrashView ? 'default' : 'pointer',
        borderColor: isDropTarget ? 'primary.main' : undefined,
        borderStyle: isDropTarget ? 'dashed' : 'solid',
        bgcolor: isDropTarget
          ? alpha(theme.palette.primary.main, 0.16)
          : isSelected ? 'action.selected' : undefined,
        transition: 'box-shadow 0.15s ease, background-color 0.15s ease',
        '&:hover': { bgcolor: 'action.hover', boxShadow: 1 },
        '&:hover [data-folder-fav]': { opacity: 1 },
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      }}
    >
      {isTrashView ? null : (
        <Checkbox
          size="small"
          checked={isSelected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleSelected(rowKey)}
          inputProps={{ 'aria-label': `Выбрать папку ${folder.name}` }}
          sx={{ p: 0.5, mr: -0.5 }}
        />
      )}
      <FolderOutlinedIcon sx={{ fontSize: 22, color: 'warning.main', flex: '0 0 auto' }} />
      <Box sx={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
        <Typography
          variant="body2"
          title={folder.name}
          sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {folder.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {Number(folder.file_count || 0) > 0 ? `${folder.file_count} шт.` : 'Пусто'}
        </Typography>
      </Box>
      {isTrashView ? null : (
        <>
          <IconButton
            size="small"
            disabled={!canWrite}
            aria-label={folder.is_favorite ? `Убрать «${folder.name}» из избранного` : `Добавить «${folder.name}» в избранное`}
            data-testid={`my-files-favorite-folder-${folder.id}`}
            data-folder-fav
            onClick={(event) => { event.stopPropagation(); void onToggleFavorite(folder, 'folder'); }}
            sx={{
              p: 0.5,
              opacity: { xs: 1, md: folder.is_favorite ? 1 : 0 },
              transition: 'opacity 0.15s',
              '@media (hover: none)': { opacity: 1 },
            }}
          >
            {folder.is_favorite
              ? <StarRoundedIcon sx={{ fontSize: 18, color: 'warning.main' }} />
              : <StarOutlineRoundedIcon sx={{ fontSize: 18 }} />}
          </IconButton>
          <IconButton
            size="small"
            aria-label={`Действия с папкой ${folder.name}`}
            data-testid={`my-files-folder-menu-${folder.id}`}
            data-folder-fav
            onClick={(event) => { event.stopPropagation(); openFolderActionsMenu(event, folder); }}
            sx={{
              p: 0.5,
              opacity: { xs: 1, md: 0 },
              transition: 'opacity 0.15s',
              '@media (hover: none)': { opacity: 1 },
            }}
          >
            <MoreVertRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </>
      )}
      {isTrashView ? (
        <Stack direction="row" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
          <Tooltip title="Восстановить">
            <IconButton
              size="small"
              disabled={!canWrite}
              aria-label={`Восстановить папку ${folder.name}`}
              onClick={(event) => { event.stopPropagation(); void handleRestoreEntry('folder', folder.id); }}
            >
              <RestoreOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Удалить навсегда">
            <IconButton
              size="small"
              color="error"
              disabled={!canWrite}
              aria-label={`Удалить навсегда папку ${folder.name}`}
              onClick={(event) => { event.stopPropagation(); void handlePurgeEntry('folder', folder.id, folder.name); }}
            >
              <DeleteForeverOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : null}
    </Paper>
  );
});

export const FileCard = memo(function FileCard({
  item,
  isTrashView,
  canWrite,
  isSelected,
  thumbUrl,
  fileDragProps,
  observeThumbTarget,
  openDocumentPreview,
  openFileActionsMenu,
  handleRestoreEntry,
  handlePurgeEntry,
  onToggleFavorite,
  toggleSelected,
}) {
  const theme = useTheme();
  const chip = statusChip(item.status, item.error_text);
  const ready = READY_STATUSES.has(String(item.status || '').toLowerCase());
  const previewSupported = ready && isMyFilePreviewSupported(item);
  const meta = getFileVisualMeta(item);
  const Icon = meta.icon;
  const colors = getFileVisualColors(theme, meta);
  const fileName = item.original_file_name || item.download_file_name || 'file.bin';
  const rowKey = `file:${item.id}`;
  return (
    <Paper
      variant="outlined"
      data-testid={`my-files-card-${item.id}`}
      {...(isTrashView ? {} : fileDragProps(item))}
      ref={(node) => {
        if (node && !thumbUrl && !isTrashView && String(item.preview_kind || '') === 'image' && item.preview_available) {
          observeThumbTarget(node, item);
        }
      }}
      onClick={() => { if (!isTrashView && previewSupported) void openDocumentPreview(item); }}
      onContextMenu={(event) => { if (!isTrashView) openFileActionsMenu(event, item); }}
      onKeyDown={(event) => {
        if (isTrashView) return;
        if (event.key === 'Enter') {
          if (previewSupported) void openDocumentPreview(item);
          else openFileActionsMenu(event, item);
        }
        if (isFileActionsKeyboardShortcut(event)) openFileActionsMenu(event, item);
      }}
      tabIndex={0}
      sx={{
        ...VIRTUALIZED_CARD_SX,
        position: 'relative',
        p: 1,
        pb: 1.25,
        textAlign: 'center',
        cursor: !isTrashView && previewSupported ? 'pointer' : 'default',
        bgcolor: isSelected ? 'action.selected' : undefined,
        transition: 'box-shadow 0.15s ease, background-color 0.15s ease',
        '&:hover': { bgcolor: 'action.hover', boxShadow: 2 },
        '&:hover [data-card-hover]': { opacity: 1 },
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      }}
    >
      {isTrashView ? null : (
        <Checkbox
          size="small"
          checked={isSelected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleSelected(rowKey)}
          inputProps={{ 'aria-label': `Выбрать файл ${fileName}` }}
          sx={{
            position: 'absolute',
            top: 4,
            left: 4,
            p: 0.5,
            zIndex: 1,
            bgcolor: alpha(theme.palette.background.paper, 0.85),
            borderRadius: '50%',
            '&:hover': { bgcolor: 'background.paper' },
          }}
        />
      )}
      {isTrashView ? null : (
        <IconButton
          size="small"
          disabled={!canWrite}
          aria-label={item.is_favorite ? `Убрать «${fileName}» из избранного` : `Добавить «${fileName}» в избранное`}
          data-testid={`my-files-favorite-${item.id}`}
          data-card-hover
          onClick={(event) => { event.stopPropagation(); void onToggleFavorite(item, 'file'); }}
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            p: 0.5,
            zIndex: 1,
            opacity: { xs: 1, md: item.is_favorite ? 1 : 0 },
            bgcolor: alpha(theme.palette.background.paper, 0.85),
            transition: 'opacity 0.15s',
            '@media (hover: none)': { opacity: 1 },
            '&:hover': { bgcolor: 'background.paper' },
          }}
        >
          {item.is_favorite
            ? <StarRoundedIcon sx={{ fontSize: 18, color: 'warning.main' }} />
            : <StarOutlineRoundedIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      )}
      {thumbUrl ? (
        <Box
          component="img"
          src={thumbUrl}
          alt={fileName}
          sx={{
            width: '100%',
            height: 110,
            objectFit: 'cover',
            borderRadius: 1.5,
            display: 'block',
            mb: 0.75,
          }}
        />
      ) : (
        <Box
          sx={{
            width: '100%',
            height: 110,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 1.5,
            mb: 0.75,
            bgcolor: colors.bg,
            color: colors.color,
          }}
        >
          <Icon sx={{ fontSize: 44 }} />
        </Box>
      )}
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 0.5, textAlign: 'left' }}>
        <Icon sx={{ fontSize: 16, color: colors.color, flex: '0 0 auto' }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            title={fileName}
            sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {fileName}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {formatFileSize(item.original_size_bytes)}
          </Typography>
        </Box>
        {String(item.status || '').toLowerCase() !== 'ready' ? (
          <Chip size="small" label={chip.label} color={chip.color} variant={chip.variant} />
        ) : null}
        {isTrashView ? null : (
          <IconButton
            size="small"
            aria-label={`Действия с файлом ${fileName}`}
            data-testid={`my-files-card-menu-${item.id}`}
            data-card-hover
            onClick={(event) => { event.stopPropagation(); openFileActionsMenu(event, item); }}
            sx={{
              p: 0.5,
              opacity: { xs: 1, md: 0 },
              transition: 'opacity 0.15s',
              '@media (hover: none)': { opacity: 1 },
            }}
          >
            <MoreVertRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Stack>
      {isTrashView ? (
        <Stack direction="row" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
          <Tooltip title="Восстановить">
            <IconButton
              size="small"
              disabled={!canWrite}
              aria-label={`Восстановить ${fileName}`}
              data-testid={`my-files-restore-${item.id}`}
              onClick={(event) => { event.stopPropagation(); void handleRestoreEntry('file', item.id); }}
            >
              <RestoreOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Удалить навсегда">
            <IconButton
              size="small"
              color="error"
              disabled={!canWrite}
              aria-label={`Удалить навсегда ${fileName}`}
              data-testid={`my-files-purge-${item.id}`}
              onClick={(event) => { event.stopPropagation(); void handlePurgeEntry('file', item.id, fileName); }}
            >
              <DeleteForeverOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : null}
    </Paper>
  );
});
