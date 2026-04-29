import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  CircularProgress,
  Dialog,
  Menu,
  MenuItem,
  Popover,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import ChatFileUploadPanel from './ChatFileUploadPanel';

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'));

const TELEGRAM_CHAT_FONT_FAMILY = [
  '"SF Pro Text"',
  '"SF Pro Display"',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ');

export default function ChatFileUploadDialog({
  caption = '',
  fileInputRef,
  files = [],
  onCaptionChange,
  onClearFiles,
  onClose,
  onRemoveFile,
  onSend,
  open = false,
  preparing = false,
  sending = false,
  theme,
  ui = {},
  uploadProgress = 0,
}) {
  const [actionsAnchorEl, setActionsAnchorEl] = useState(null);
  const [captionEmojiAnchorEl, setCaptionEmojiAnchorEl] = useState(null);
  const selectedFiles = Array.isArray(files) ? files : [];
  const busy = Boolean(preparing || sending);
  const normalizedUploadProgress = Math.max(0, Math.min(100, Math.round(Number(uploadProgress || 0))));
  const isDarkTheme = theme?.palette?.mode === 'dark';
  const popupSurface = ui.drawerBg || ui.panelBg || (isDarkTheme ? '#17212b' : '#ffffff');
  const popupTextColor = ui.textStrong || (isDarkTheme ? '#f8fafc' : '#17212b');
  const popupIconColor = isDarkTheme ? alpha('#ffffff', 0.86) : alpha('#17212b', 0.78);
  const popupBorderColor = ui.borderSoft || (isDarkTheme ? alpha('#ffffff', 0.06) : alpha('#17212b', 0.08));
  const popupHoverBg = ui.drawerHover || ui.surfaceHover || (isDarkTheme ? alpha('#ffffff', 0.07) : alpha('#17212b', 0.06));
  const popupShadow = ui.shadowStrong || (isDarkTheme ? '0 20px 56px rgba(0, 0, 0, 0.42)' : '0 18px 48px rgba(15, 23, 42, 0.18)');
  const actionsMenuOpen = Boolean(actionsAnchorEl);

  useEffect(() => {
    if (!open) {
      setActionsAnchorEl(null);
      setCaptionEmojiAnchorEl(null);
    }
  }, [open]);

  const triggerFilePicker = useCallback(() => {
    if (busy) return;
    fileInputRef?.current?.click?.();
  }, [busy, fileInputRef]);

  const openActionsMenu = useCallback((event) => {
    if (busy) return;
    setActionsAnchorEl(event.currentTarget);
  }, [busy]);

  const closeActionsMenu = useCallback(() => {
    setActionsAnchorEl(null);
  }, []);

  const clearFiles = useCallback(() => {
    closeActionsMenu();
    setCaptionEmojiAnchorEl(null);
    onClearFiles?.();
  }, [closeActionsMenu, onClearFiles]);

  const openCaptionEmojiPicker = useCallback((event) => {
    if (busy) return;
    setCaptionEmojiAnchorEl(event.currentTarget);
  }, [busy]);

  const closeCaptionEmojiPicker = useCallback(() => {
    setCaptionEmojiAnchorEl(null);
  }, []);

  const insertCaptionEmoji = useCallback((emoji) => {
    const nextEmoji = String(emoji || '');
    if (!nextEmoji) return;
    onCaptionChange?.(`${String(caption || '')}${nextEmoji}`);
  }, [caption, onCaptionChange]);

  const dialogPaperSx = useMemo(() => ({
    m: 1.5,
    width: {
      xs: 'min(calc(100vw - 20px), 430px)',
      sm: 'min(calc(100vw - 48px), 520px)',
    },
    maxWidth: '100%',
    borderRadius: '8px',
    border: 'none',
    bgcolor: 'transparent',
    color: popupTextColor,
    backgroundImage: 'none',
    boxShadow: 'none',
    overflow: 'visible',
    fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
  }), [popupTextColor]);

  return (
    <>
      <Dialog
        open={open}
        onClose={busy ? undefined : onClose}
        fullScreen={false}
        fullWidth={false}
        maxWidth={false}
        PaperProps={{ sx: dialogPaperSx }}
      >
        <ChatFileUploadPanel
          autoFocusCaption
          caption={caption}
          disabled={busy}
          files={selectedFiles}
          mode="dialog"
          onAdd={triggerFilePicker}
          onCancel={clearFiles}
          onCaptionChange={onCaptionChange}
          onOpenEmoji={openCaptionEmojiPicker}
          onOpenMenu={openActionsMenu}
          onRemoveFile={onRemoveFile}
          onSend={onSend}
          preparing={preparing}
          sending={sending}
          theme={theme}
          ui={ui}
          uploadProgress={normalizedUploadProgress}
        />
      </Dialog>

      <Popover
        open={Boolean(captionEmojiAnchorEl)}
        anchorEl={captionEmojiAnchorEl}
        onClose={closeCaptionEmojiPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        PaperProps={{
          elevation: 12,
          sx: {
            borderRadius: 3,
            border: `1px solid ${alpha(ui.borderSoft || popupBorderColor, 0.96)}`,
            bgcolor: alpha(ui.panelBg || popupSurface, 0.98),
            backdropFilter: 'blur(10px)',
            overflow: 'hidden',
          },
        }}
      >
        {captionEmojiAnchorEl ? (
          <Suspense
            fallback={(
              <Box sx={{ width: 320, height: 360, display: 'grid', placeItems: 'center' }}>
                <CircularProgress size={24} />
              </Box>
            )}
          >
            <LazyEmojiPicker
              onEmojiClick={(emojiData) => insertCaptionEmoji(emojiData?.emoji || '')}
              autoFocusSearch={false}
              searchPlaceholder="Найти эмодзи"
              skinTonesDisabled={false}
              previewConfig={{ showPreview: false }}
              width={320}
              height={360}
              theme={isDarkTheme ? 'dark' : 'light'}
            />
          </Suspense>
        ) : null}
      </Popover>

      <Menu
        anchorEl={actionsAnchorEl}
        open={actionsMenuOpen}
        onClose={closeActionsMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          elevation: 0,
          sx: {
            minWidth: 210,
            borderRadius: 2.4,
            border: `1px solid ${popupBorderColor}`,
            bgcolor: popupSurface,
            color: popupTextColor,
            backgroundImage: 'none',
            boxShadow: popupShadow,
            '& .MuiMenuItem-root': {
              gap: 1.25,
              minHeight: 42,
              fontWeight: 600,
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              color: popupTextColor,
              '&:hover': { bgcolor: popupHoverBg },
            },
            '& .MuiSvgIcon-root': {
              color: popupIconColor,
            },
          },
        }}
      >
        <MenuItem
          data-testid="file-dialog-add-more"
          onClick={() => {
            closeActionsMenu();
            triggerFilePicker();
          }}
          disabled={busy}
        >
          <AttachFileRoundedIcon fontSize="small" />
          Добавить ещё
        </MenuItem>
        <MenuItem onClick={clearFiles} disabled={busy || selectedFiles.length === 0}>
          <DeleteOutlineIcon fontSize="small" />
          Очистить список
        </MenuItem>
      </Menu>
    </>
  );
}
