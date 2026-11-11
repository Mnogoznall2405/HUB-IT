import { ButtonBase, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { buildMailUiTokens, getMailAttachmentIconTileSx } from './mailUiTokens';
import { getMailAttachmentVisual } from './mailAttachmentVisuals';

export default function MailAttachmentIconTile({
  attachment,
  index = 0,
  label = '',
  onOpen,
  testId,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const visual = getMailAttachmentVisual(attachment);
  const IconComponent = visual.Icon;
  const name = String(attachment?.name || 'attachment.bin').trim();
  const ariaLabel = label || name;

  return (
    <ButtonBase
      data-testid={testId || `mail-attachment-icon-tile-${index}`}
      aria-label={ariaLabel}
      onClick={() => onOpen?.(attachment)}
      sx={getMailAttachmentIconTileSx(tokens)}
    >
      <IconComponent sx={{ color: visual.color, fontSize: 24 }} />
    </ButtonBase>
  );
}

export function MailAttachmentOverflowTile({
  overflowCount = 0,
  onClick,
  testId = 'mail-attachment-overflow-tile',
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  if (overflowCount <= 0) return null;

  return (
    <ButtonBase
      data-testid={testId}
      aria-label={`Ещё ${overflowCount} вложений`}
      onClick={onClick}
      sx={getMailAttachmentIconTileSx(tokens, {
        bgcolor: tokens.isDark ? '#20252d' : '#eef1f5',
      })}
    >
      <Typography sx={{ fontWeight: 800, fontSize: '0.82rem', color: tokens.textPrimary }}>
        {`+${overflowCount}`}
      </Typography>
    </ButtonBase>
  );
}
