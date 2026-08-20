import { useEffect, useState } from 'react';
import { Box, Button, InputBase, TextField } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { getMailQuickReplyInputSx } from './mailUiTokens';

/**
 * Leaf quick-reply draft: local text state only.
 * Keystrokes must not lift into Mail.jsx / MailConversationReader.
 */
export default function MailQuickReplyDraftField({
  draftKey,
  draftEpoch = 0,
  sending = false,
  disabled = false,
  variant = 'desktop',
  tokens,
  ui,
  value,
  onChange,
  onSend,
  onFocus,
  children,
  placeholder = 'Ответить на письмо…',
}) {
  const isControlled = typeof value === 'string';
  const [uncontrolledDraft, setUncontrolledDraft] = useState('');

  useEffect(() => {
    if (!isControlled) setUncontrolledDraft('');
  }, [draftKey, draftEpoch, isControlled]);

  const draft = isControlled ? value : uncontrolledDraft;
  const setDraft = (next) => {
    if (!isControlled) setUncontrolledDraft(next);
    onChange?.(next);
  };

  const canSend = !sending && !disabled && Boolean(String(draft || '').trim());

  const handleSend = () => {
    if (!canSend) return;
    onSend?.(draft);
  };

  if (variant === 'bar') {
    return (
      <>
        <Box sx={getMailQuickReplyInputSx(tokens)}>
          <EditOutlinedIcon sx={{ color: tokens?.textSecondary, fontSize: 18 }} />
          <InputBase
            disabled={disabled || sending}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={onFocus}
            placeholder={placeholder}
            fullWidth
            multiline
            maxRows={3}
            inputProps={{ 'data-testid': 'mail-quick-reply-input' }}
            sx={{
              fontSize: '0.875rem',
              color: tokens?.textPrimary,
              '& .MuiInputBase-input': {
                p: 0,
              },
              '& .MuiInputBase-input::placeholder': {
                color: tokens?.textSecondary,
                opacity: 1,
              },
            }}
          />
        </Box>
        <Button
          data-testid="mail-quick-reply-send"
          aria-label="Отправить быстрый ответ"
          size="small"
          variant="contained"
          disabled={!canSend}
          onClick={handleSend}
          sx={{
            minHeight: 36,
            textTransform: 'none',
            fontWeight: 700,
            flexShrink: 0,
            boxShadow: 'none',
          }}
        >
          Отправить
        </Button>
      </>
    );
  }

  return (
    <>
      <TextField
        multiline
        minRows={2}
        maxRows={6}
        size="small"
        label="Быстрый ответ"
        placeholder="Напишите сообщение..."
        value={draft}
        disabled={disabled || sending}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        inputProps={{ 'data-testid': 'mail-quick-reply-body' }}
        InputProps={{ sx: { borderRadius: ui?.inputRadius } }}
        fullWidth
      />
      {typeof children === 'function'
        ? children({ draft, canSend, sending, send: handleSend })
        : (
          <Button
            data-testid="mail-quick-reply-send"
            size="small"
            variant="contained"
            disabled={!canSend}
            onClick={handleSend}
          >
            {sending ? 'Отправка...' : 'Отправить'}
          </Button>
        )}
    </>
  );
}
