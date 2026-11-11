import { Box, ButtonBase, IconButton, Typography } from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import {
  getMailAttachmentCompactBadgeSx,
  getMailAttachmentCompactCardSx,
} from './mailUiTokens';
import { getAttachmentExtensionBadge } from './mailAttachmentLayout';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';

export default function MailAttachmentCompactCard({
  attachment,
  index = 0,
  formatFileSize,
  onOpen,
  onFileActions,
  onMenuOpen,
  menuOpen = false,
  tokens,
  testId,
}) {
  const visual = getMailAttachmentVisual(attachment);
  const name = String(attachment?.name || 'attachment.bin').trim();
  const size = Number(attachment?.size || 0);
  const sizeLabel = size > 0 && typeof formatFileSize === 'function' ? formatFileSize(size) : '';
  const badgeLabel = getAttachmentExtensionBadge(name);

  return (
    <Box
      data-testid={testId || `mail-attachment-compact-card-${index}`}
      onContextMenu={(event) => onFileActions?.(event, attachment)}
      sx={getMailAttachmentCompactCardSx(tokens, { position: 'relative', p: 0 })}
    >
      <ButtonBase
        aria-label={`Просмотр вложения ${name}`}
        onClick={() => onOpen?.(attachment)}
        onKeyDown={(event) => onFileActions?.(event, attachment)}
        sx={{
          width: '100%',
          height: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          textAlign: 'left',
          p: 0.85,
          pr: 3.5,
        }}
      >
        <Typography
          component="span"
          sx={getMailAttachmentCompactBadgeSx(tokens, visual.color)}
        >
          {badgeLabel}
        </Typography>
        <Typography
          sx={{
            width: '100%',
            mt: 0.45,
            color: tokens.textPrimary,
            fontSize: '0.78rem',
            fontWeight: 600,
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textAlign: 'left',
          }}
        >
          {name}
        </Typography>
        {sizeLabel ? (
          <Typography
            sx={{
              mt: 0.35,
              color: tokens.textSecondary,
              fontSize: '0.72rem',
              lineHeight: 1.1,
            }}
          >
            {sizeLabel}
          </Typography>
        ) : null}
      </ButtonBase>
      <IconButton
        size="small"
        aria-label={`Действия для вложения ${name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen ? 'true' : undefined}
        onClick={(event) => onMenuOpen?.(event, attachment)}
        sx={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 30,
          height: 30,
          color: tokens.textSecondary,
          '&:active': { transform: 'scale(0.96)' },
        }}
      >
        <KeyboardArrowDownRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
