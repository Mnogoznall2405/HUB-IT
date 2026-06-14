import { Box, ButtonBase, Typography } from '@mui/material';
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
  tokens,
  testId,
}) {
  const visual = getMailAttachmentVisual(attachment);
  const name = String(attachment?.name || 'attachment.bin').trim();
  const size = Number(attachment?.size || 0);
  const sizeLabel = size > 0 && typeof formatFileSize === 'function' ? formatFileSize(size) : '';
  const badgeLabel = getAttachmentExtensionBadge(name);

  return (
    <ButtonBase
      data-testid={testId || `mail-attachment-compact-card-${index}`}
      aria-label={name}
      onClick={() => onOpen?.(attachment)}
      sx={getMailAttachmentCompactCardSx(tokens)}
    >
      <Box component="span" sx={getMailAttachmentCompactBadgeSx(tokens, visual.color)}>
        {badgeLabel}
      </Box>
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
  );
}
