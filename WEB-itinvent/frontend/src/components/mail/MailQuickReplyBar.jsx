import { Box, IconButton, InputBase, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import {
  buildMailUiTokens,
  getMailQuickReplyBarSx,
  getMailQuickReplyInputSx,
} from './mailUiTokens';

export default function MailQuickReplyBar({
  value = '',
  sending = false,
  disabled = false,
  embedded = false,
  onChange,
  onSend,
  onFocus,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const canSend = !sending && !disabled && String(value || '').trim();

  return (
    <Box data-testid="mail-quick-reply-bar" sx={getMailQuickReplyBarSx(tokens, { embedded })}>
      <Box sx={getMailQuickReplyInputSx(tokens)}>
        <EditOutlinedIcon sx={{ color: tokens.textSecondary, fontSize: 18 }} />
        <InputBase
          data-testid="mail-quick-reply-input"
          value={value}
          disabled={disabled || sending}
          onChange={(event) => onChange?.(event.target.value)}
          onFocus={onFocus}
          placeholder="Быстрый ответ…"
          fullWidth
          multiline
          maxRows={3}
          sx={{
            fontSize: '0.9rem',
            color: tokens.textPrimary,
            '& .MuiInputBase-input': {
              p: 0,
            },
          }}
        />
      </Box>
      <IconButton
        data-testid="mail-quick-reply-send"
        aria-label="Отправить быстрый ответ"
        disabled={!canSend}
        onClick={() => onSend?.()}
        sx={{ color: canSend ? 'primary.main' : tokens.textSecondary }}
      >
        <SendRoundedIcon />
      </IconButton>
      {sending ? (
        <Typography sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Отправка
        </Typography>
      ) : null}
    </Box>
  );
}
