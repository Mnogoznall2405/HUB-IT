import { Box } from '@mui/material';
import MailQuickReplyComposer from './MailQuickReplyComposer';

export default function MailPreviewMobileReplySection({
  quickReplyDraftKey,
  quickReplyDraftEpoch = 0,
  quickReplySending = false,
  quickReplyDisabled = false,
  startCollapsed = false,
  onSendQuickReply,
  onQuickReplyFocus,
  smartReplySuggestions = [],
  smartReplyLoading = false,
  smartReplyChipsEnabled = true,
  placeholder,
}) {
  return (
    <Box data-testid="mail-preview-mobile-reply-section">
      <MailQuickReplyComposer
        embedded
        startCollapsed={startCollapsed}
        draftKey={quickReplyDraftKey}
        draftEpoch={quickReplyDraftEpoch}
        sending={quickReplySending}
        disabled={quickReplyDisabled}
        chipsEnabled={smartReplyChipsEnabled}
        suggestions={smartReplySuggestions}
        chipsLoading={smartReplyLoading}
        placeholder={placeholder}
        onSend={onSendQuickReply}
        onFocus={onQuickReplyFocus}
      />
    </Box>
  );
}
