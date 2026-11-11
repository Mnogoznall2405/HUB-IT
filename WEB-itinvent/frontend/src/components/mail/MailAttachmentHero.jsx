import { Box, ButtonBase, IconButton, Stack, Typography } from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { alpha, useTheme } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import MailAttachmentCompactCard from './MailAttachmentCompactCard';
import MailAttachmentsSheet from './MailAttachmentsSheet';
import { shouldUseCompactAttachmentLayout, buildAttachmentFilesLabel } from './mailAttachmentLayout';
import { buildMailUiTokens, getMailAttachmentStripSx } from './mailUiTokens';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';
import {
  readMailAttachmentsExpandedPreference,
  writeMailAttachmentsExpandedPreference,
} from './mailAttachmentExpandState';
import FileActionsContextMenu, {
  getFileActionsAnchorPosition,
  isFileActionsKeyboardShortcut,
} from '../fileActions/FileActionsContextMenu';

function MailAttachmentHeroCard({
  attachment,
  index = 0,
  formatFileSize,
  onOpen,
  onFileActions,
  onMenuOpen,
  menuOpen = false,
  tokens,
}) {
  const visual = getMailAttachmentVisual(attachment);
  const IconComponent = visual.Icon;
  const name = String(attachment?.name || 'attachment.bin').trim();
  const size = Number(attachment?.size || 0);
  const sizeLabel = size > 0 && typeof formatFileSize === 'function' ? formatFileSize(size) : '';

  return (
    <Box
      data-testid={`mail-attachment-hero-item-${index}`}
      onContextMenu={(event) => onFileActions?.(event, attachment)}
      sx={{
        width: '100%',
        minHeight: 52,
        maxHeight: 60,
        display: 'flex',
        alignItems: 'stretch',
        textAlign: 'left',
        borderRadius: tokens.radiusMd,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: tokens.isDark ? alpha('#ffffff', 0.08) : '#e7e9ee',
        bgcolor: tokens.isDark ? '#191d24' : '#f5f6f8',
      }}
    >
      <ButtonBase
        aria-label={`Просмотр вложения ${name}`}
        onClick={() => onOpen?.(attachment)}
        onKeyDown={(event) => onFileActions?.(event, attachment)}
        sx={{
          minWidth: 0,
          flex: 1,
          display: 'flex',
          alignItems: 'stretch',
          textAlign: 'left',
        }}
      >
        <Box
          sx={{
        width: 40,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: tokens.isDark ? alpha('#ffffff', 0.04) : alpha(visual.color, 0.08),
          }}
        >
          <IconComponent sx={{ color: visual.color, fontSize: 22 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, px: 1.1, py: 0.55, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.92rem', noWrap: true, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </Typography>
          <Typography sx={{ mt: 0.2, color: tokens.textSecondary, fontSize: '0.78rem' }}>
            {[visual.label, sizeLabel].filter(Boolean).join(' • ')}
          </Typography>
        </Box>
      </ButtonBase>
      <Box sx={{ display: 'grid', placeItems: 'center', px: 0.35 }}>
        <IconButton
          size="small"
          aria-label={`Действия для вложения ${name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen ? 'true' : undefined}
          onClick={(event) => onMenuOpen?.(event, attachment)}
          sx={{
            width: 36,
            height: 36,
            color: tokens.textSecondary,
            '&:active': { transform: 'scale(0.96)' },
          }}
        >
          <KeyboardArrowDownRoundedIcon />
        </IconButton>
      </Box>
    </Box>
  );
}

export default function MailAttachmentHero({
  attachments = [],
  attachmentTotalSize = '',
  formatFileSize,
  onOpen,
  onDownload,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const compactPreferred = shouldUseCompactAttachmentLayout(attachments.length);
  const [expanded, setExpanded] = useState(() => (
    readMailAttachmentsExpandedPreference(!compactPreferred)
  ));
  const [fileActionsMenu, setFileActionsMenu] = useState({
    attachment: null,
    anchorEl: null,
    anchorPosition: null,
  });

  if (!attachments.length) return null;

  const filesLabel = buildAttachmentFilesLabel(attachments.length);
  const headerParts = ['Вложения', filesLabel, attachmentTotalSize].filter(Boolean);
  const openSheet = () => setSheetOpen(true);
  const openFileActionsMenu = (event, attachment) => {
    if (event.type === 'keydown' && !isFileActionsKeyboardShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setFileActionsMenu({
      attachment,
      anchorEl: null,
      anchorPosition: getFileActionsAnchorPosition(event),
    });
  };
  const openAnchoredFileActionsMenu = (event, attachment) => {
    event.preventDefault();
    event.stopPropagation();
    setFileActionsMenu({ attachment, anchorEl: event.currentTarget, anchorPosition: null });
  };
  const closeFileActionsMenu = () => {
    setFileActionsMenu({ attachment: null, anchorEl: null, anchorPosition: null });
  };
  const isMenuOpenFor = (attachment) => Boolean(
    (fileActionsMenu.anchorEl || fileActionsMenu.anchorPosition)
    && fileActionsMenu.attachment === attachment
  );

  return (
    <>
      <Stack data-testid="mail-attachment-hero" spacing={0.65} sx={{ mb: 1.1 }}>
        <Box
          data-testid="mail-attachment-hero-header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            minHeight: 28,
          }}
        >
          <Typography
            data-testid="mail-attachment-summary-row"
            noWrap
            sx={{ fontWeight: 700, fontSize: '0.82rem', color: tokens.textPrimary, minWidth: 0 }}
          >
            {headerParts.join(' · ')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            {attachments.length > 3 ? (
              <ButtonBase
                data-testid="mail-attachment-show-all"
                onClick={openSheet}
                sx={{
                  px: 0.75,
                  py: 0.25,
                  borderRadius: tokens.radiusSm,
                  color: 'primary.main',
                  fontWeight: 700,
                  fontSize: '0.78rem',
                }}
              >
                Все
              </ButtonBase>
            ) : null}
            <ButtonBase
              data-testid="mail-attachment-hero-toggle"
              onClick={() => {
                setExpanded((prev) => {
                  const next = !prev;
                  writeMailAttachmentsExpandedPreference(next);
                  return next;
                });
              }}
              sx={{
                px: 0.75,
                py: 0.25,
                borderRadius: tokens.radiusSm,
                color: 'primary.main',
                fontWeight: 700,
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.25,
              }}
            >
              {expanded ? 'Свернуть' : 'Показать'}
              {expanded
                ? <KeyboardArrowUpRoundedIcon sx={{ fontSize: 18 }} />
                : <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18 }} />}
            </ButtonBase>
          </Box>
        </Box>

        {expanded ? (
          attachments.map((attachment, index) => (
            <MailAttachmentHeroCard
              key={`${attachment?.id || attachment?.name || index}`}
              attachment={attachment}
              index={index}
              formatFileSize={formatFileSize}
              onOpen={onOpen}
              onFileActions={openFileActionsMenu}
              onMenuOpen={openAnchoredFileActionsMenu}
              menuOpen={isMenuOpenFor(attachment)}
              tokens={tokens}
            />
          ))
        ) : (
          <Box
            data-testid="mail-attachment-compact-strip"
            sx={getMailAttachmentStripSx(tokens)}
          >
            {attachments.map((attachment, index) => (
              <MailAttachmentCompactCard
                key={`${attachment?.id || attachment?.name || index}`}
                attachment={attachment}
                index={index}
                formatFileSize={formatFileSize}
                onOpen={onOpen}
                onFileActions={openFileActionsMenu}
                onMenuOpen={openAnchoredFileActionsMenu}
                menuOpen={isMenuOpenFor(attachment)}
                tokens={tokens}
              />
            ))}
          </Box>
        )}
      </Stack>

      <MailAttachmentsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        attachments={attachments}
        formatFileSize={formatFileSize}
        onOpen={onOpen}
        onFileActions={openFileActionsMenu}
        onMenuOpen={openAnchoredFileActionsMenu}
        activeAttachment={fileActionsMenu.attachment}
      />

      <FileActionsContextMenu
        open={Boolean(fileActionsMenu.anchorEl || fileActionsMenu.anchorPosition)}
        anchorEl={fileActionsMenu.anchorEl}
        anchorPosition={fileActionsMenu.anchorPosition}
        fileName={fileActionsMenu.attachment?.name || ''}
        canDownload={Boolean(fileActionsMenu.attachment && typeof onDownload === 'function')}
        onPreview={fileActionsMenu.attachment
          ? () => onOpen?.(fileActionsMenu.attachment)
          : undefined}
        onClose={closeFileActionsMenu}
        onDownload={fileActionsMenu.attachment
          ? () => onDownload?.(fileActionsMenu.attachment)
          : undefined}
        onSaveAll={attachments.length > 1 && typeof onDownload === 'function'
          ? () => attachments.forEach((attachment) => onDownload(attachment))
          : undefined}
      />
    </>
  );
}
