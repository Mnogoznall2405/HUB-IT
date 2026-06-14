import { Box } from '@mui/material';
import MailQuickReplyBar from './MailQuickReplyBar';
import MailSmartReplyChips from './MailSmartReplyChips';

export default function MailPreviewMobileReplySection({
  quickReplyBody = '',
  quickReplySending = false,
  quickReplyDisabled = false,
  onQuickReplyBodyChange,
  onSendQuickReply,
  onQuickReplyFocus,
  smartReplySuggestions = [],
  smartReplyLoading = false,
  onSmartReplySelect,
}) {
  return (
    <Box data-testid="mail-preview-mobile-reply-section">
      <MailQuickReplyBar
        embedded
        value={quickReplyBody}
        sending={quickReplySending}
        disabled={quickReplyDisabled}
        onChange={onQuickReplyBodyChange}
        onSend={onSendQuickReply}
        onFocus={onQuickReplyFocus}
      />
      <MailSmartReplyChips
        embedded
        suggestions={smartReplySuggestions}
        loading={smartReplyLoading}
        disabled={quickReplySending || quickReplyDisabled}
        onSelect={onSmartReplySelect}
      />
    </Box>
  );
}
