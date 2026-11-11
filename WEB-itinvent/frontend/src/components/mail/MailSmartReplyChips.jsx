import { Box, Chip, Skeleton } from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import { buildMailUiTokens, getMailSmartReplyChipsSx } from './mailUiTokens';

export default function MailSmartReplyChips({
  suggestions = [],
  loading = false,
  disabled = false,
  embedded = false,
  onSelect,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  if (!loading && !suggestions.length) return null;

  return (
    <Box data-testid="mail-smart-reply-chips" sx={getMailSmartReplyChipsSx(tokens, { embedded })}>
      {loading ? (
        [0, 1, 2].map((index) => (
          <Skeleton
            key={`smart-reply-skeleton-${index}`}
            variant="rounded"
            width={index === 1 ? 148 : 112}
            height={32}
            sx={{ borderRadius: tokens.chipRadius, flexShrink: 0 }}
          />
        ))
      ) : suggestions.map((suggestion, index) => (
        <Chip
          key={`${suggestion}-${index}`}
          data-testid={`mail-smart-reply-chip-${index}`}
          label={suggestion}
          clickable
          disabled={disabled}
          onClick={() => onSelect?.(suggestion)}
          sx={{
            flexShrink: 0,
            height: 32,
            borderRadius: tokens.chipRadius,
            fontWeight: 600,
            fontSize: '0.82rem',
          }}
        />
      ))}
    </Box>
  );
}
