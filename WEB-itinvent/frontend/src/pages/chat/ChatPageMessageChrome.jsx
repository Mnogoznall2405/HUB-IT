import { Alert } from '@mui/material';
import { lazy, Suspense } from 'react';

import { CHAT_FILE_ACCEPT } from '../../components/chat/chatHelpers';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import OpenCodeMyFilesPicker from '../../components/chat/OpenCodeMyFilesPicker';

// The AI mail editor pulls DOMPurify into the graph (~54 kB gzip); load it on
// first open so it stays out of the chat chunk.
const AiMailActionEditDialog = lazy(() => import('./AiMailActionEditDialog'));

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
  sandboxScope = '',
  filesBusy = false,
}) {
  const alertSx = { borderRadius: isPhone ? 0 : 3, py: isPhone ? 0.15 : undefined };

  return (
    <>
      {sandboxScope ? <OpenCodeMyFilesPicker key={sandboxScope} onSelectFiles={onSelectFiles} disabled={filesBusy} /> : null}
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
      {mailActionEditor ? (
        <Suspense fallback={null}>
          <AiMailActionEditDialog
            open
            actionCard={mailActionEditor?.actionCard}
            availableAttachments={chatMailAttachmentOptions}
            onClose={onCloseMailActionEditor}
            onSubmit={onSubmitMailActionEdit}
          />
        </Suspense>
      ) : null}
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
