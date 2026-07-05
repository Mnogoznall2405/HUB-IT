import { Alert } from '@mui/material';

import { CHAT_FILE_ACCEPT } from '../../components/chat/chatHelpers';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import AiMailActionEditDialog from './AiMailActionEditDialog';

export default function ChatPageMessageChrome({
  isPhone = false,
  fileInputRef,
  mediaFileInputRef,
  onSelectFiles,
  mailActionEditor,
  chatMailAttachmentOptions,
  onCloseMailActionEditor,
  onSubmitMailActionEdit,
  healthError = '',
  activeAiLiveDataNotice = null,
}) {
  const alertSx = { borderRadius: isPhone ? 0 : 3, py: isPhone ? 0.15 : undefined };

  return (
    <>
      <input
        ref={fileInputRef}
        data-testid="chat-file-input"
        type="file"
        hidden
        multiple
        accept={CHAT_FILE_ACCEPT}
        onChange={onSelectFiles}
      />
      <input
        ref={mediaFileInputRef}
        data-testid="chat-media-file-input"
        type="file"
        hidden
        multiple
        accept="image/*,video/*"
        onChange={onSelectFiles}
      />
      <AiMailActionEditDialog
        open={Boolean(mailActionEditor)}
        actionCard={mailActionEditor?.actionCard}
        availableAttachments={chatMailAttachmentOptions}
        onClose={onCloseMailActionEditor}
        onSubmit={onSubmitMailActionEdit}
      />
      {!CHAT_FEATURE_ENABLED ? (
        <Alert severity="info" sx={alertSx}>
          Раздел Chat скрыт feature flag `VITE_CHAT_ENABLED`.
        </Alert>
      ) : null}
      {healthError ? (
        <Alert severity="warning" sx={alertSx}>
          {healthError}
        </Alert>
      ) : null}
      {activeAiLiveDataNotice ? (
        <Alert severity={activeAiLiveDataNotice.severity} sx={alertSx}>
          {activeAiLiveDataNotice.text}
        </Alert>
      ) : null}
    </>
  );
}
