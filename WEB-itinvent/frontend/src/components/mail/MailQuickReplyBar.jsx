import { Box, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  buildMailUiTokens,
  getMailQuickReplyBarSx,
} from './mailUiTokens';
import MailQuickReplyDraftField from './MailQuickReplyDraftField';

export default function MailQuickReplyBar({
  draftKey,
  draftEpoch = 0,
  sending = false,
  disabled = false,
  embedded = false,
  value,
  onChange,
  onSend,
  onFocus,
  placeholder,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Box data-testid="mail-quick-reply-bar" sx={getMailQuickReplyBarSx(tokens, { embedded })}>
      <MailQuickReplyDraftField
        variant="bar"
        draftKey={draftKey}
        draftEpoch={draftEpoch}
        sending={sending}
        disabled={disabled}
        tokens={tokens}
        value={value}
        onChange={onChange}
        onSend={onSend}
        onFocus={onFocus}
        placeholder={placeholder}
      />
      {sending ? (
        <Typography sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Отправка
        </Typography>
      ) : null}
    </Box>
  );
}
