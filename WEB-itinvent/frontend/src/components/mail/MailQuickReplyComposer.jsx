import { useEffect, useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import MailQuickReplyBar from './MailQuickReplyBar';
import MailSmartReplyChips from './MailSmartReplyChips';

/**
 * Owns local quick-reply draft + smart-reply chips.
 * Chip click inserts text into the field; only Send calls onSend(body).
 */
export default function MailQuickReplyComposer({
  draftKey,
  draftEpoch = 0,
  sending = false,
  disabled = false,
  embedded = false,
  startCollapsed = false,
  chipsEnabled = true,
  suggestions = [],
  chipsLoading = false,
  placeholder = 'Ответить на письмо…',
  onSend,
  onFocus,
}) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(!startCollapsed);

  useEffect(() => {
    setDraft('');
    setExpanded(!startCollapsed);
  }, [draftKey, draftEpoch, startCollapsed]);

  const handleChipSelect = (suggestion) => {
    const next = String(suggestion || '').trim();
    if (!next) return;
    setDraft(next);
    setExpanded(true);
  };

  if (!expanded) {
    return (
      <Box data-testid="mail-quick-reply-composer" sx={{ px: embedded ? 1.25 : 0, py: 0.75 }}>
        <ButtonBase
          data-testid="mail-quick-reply-collapsed"
          disabled={disabled || sending}
          onClick={() => {
            setExpanded(true);
            onFocus?.();
          }}
          sx={{
            width: '100%',
            minHeight: 40,
            px: 1.35,
            justifyContent: 'flex-start',
            borderRadius: '8px',
            fontSize: '0.875rem',
            color: 'text.secondary',
            bgcolor: (theme) => (theme.palette.mode === 'dark'
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(0,0,0,0.04)'),
            border: '1px solid',
            borderColor: (theme) => (theme.palette.mode === 'dark'
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(0,0,0,0.08)'),
          }}
        >
          {placeholder}
        </ButtonBase>
      </Box>
    );
  }

  return (
    <Box data-testid="mail-quick-reply-composer">
      <MailQuickReplyBar
        embedded={embedded}
        draftKey={draftKey}
        draftEpoch={draftEpoch}
        sending={sending}
        disabled={disabled}
        value={draft}
        onChange={setDraft}
        onSend={onSend}
        onFocus={onFocus}
        placeholder={placeholder}
      />
      {chipsEnabled ? (
        <MailSmartReplyChips
          embedded={embedded}
          suggestions={suggestions}
          loading={chipsLoading}
          disabled={sending || disabled}
          onSelect={handleChipSelect}
        />
      ) : null}
    </Box>
  );
}
