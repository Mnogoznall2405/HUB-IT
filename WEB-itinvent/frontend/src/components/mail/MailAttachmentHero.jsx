import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import MailAttachmentCompactCard from './MailAttachmentCompactCard';
import MailAttachmentsSheet, { MailAttachmentSummaryRow } from './MailAttachmentsSheet';
import { shouldUseCompactAttachmentLayout } from './mailAttachmentLayout';
import { buildMailUiTokens, getMailAttachmentStripSx } from './mailUiTokens';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';

function MailAttachmentHeroCard({
  attachment,
  index = 0,
  formatFileSize,
  onOpen,
  tokens,
}) {
  const visual = getMailAttachmentVisual(attachment);
  const IconComponent = visual.Icon;
  const name = String(attachment?.name || 'attachment.bin').trim();
  const size = Number(attachment?.size || 0);
  const sizeLabel = size > 0 && typeof formatFileSize === 'function' ? formatFileSize(size) : '';

  return (
    <ButtonBase
      data-testid={`mail-attachment-hero-item-${index}`}
      onClick={() => onOpen?.(attachment)}
      sx={{
        width: '100%',
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
      <Box
        sx={{
          width: 56,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          bgcolor: tokens.isDark ? alpha('#ffffff', 0.04) : alpha(visual.color, 0.08),
        }}
      >
        <IconComponent sx={{ color: visual.color, fontSize: 28 }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1, px: 1.2, py: 1.05 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.92rem', noWrap: true, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </Typography>
        <Typography sx={{ mt: 0.2, color: tokens.textSecondary, fontSize: '0.78rem' }}>
          {[visual.label, sizeLabel].filter(Boolean).join(' • ')}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

export default function MailAttachmentHero({
  attachments = [],
  attachmentTotalSize = '',
  formatFileSize,
  onOpen,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!attachments.length) return null;

  const compact = shouldUseCompactAttachmentLayout(attachments.length);
  const openSheet = () => setSheetOpen(true);

  return (
    <>
      <Stack data-testid="mail-attachment-hero" spacing={compact ? 0.65 : 0.85} sx={{ mb: 1.25 }}>
        {compact ? (
          <>
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
                  tokens={tokens}
                />
              ))}
            </Box>
            <MailAttachmentSummaryRow
              count={attachments.length}
              totalSizeLabel={attachmentTotalSize}
              onShowAll={attachments.length > 3 ? openSheet : undefined}
              tokens={tokens}
              placement="below"
            />
          </>
        ) : (
          attachments.map((attachment, index) => (
            <MailAttachmentHeroCard
              key={`${attachment?.id || attachment?.name || index}`}
              attachment={attachment}
              index={index}
              formatFileSize={formatFileSize}
              onOpen={onOpen}
              tokens={tokens}
            />
          ))
        )}
      </Stack>

      <MailAttachmentsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        attachments={attachments}
        formatFileSize={formatFileSize}
        onOpen={onOpen}
      />
    </>
  );
}
