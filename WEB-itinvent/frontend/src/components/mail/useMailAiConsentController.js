import { useCallback, useState } from 'react';
import { isMailAiEnabled, setMailAiEnabled } from './mailAiFlags';
import { isMailSmartReplyChipsEnabled } from './mailSmartReplyFlags';

export default function useMailAiConsentController({
  storage,
  envValue,
  chipsEnabled,
} = {}) {
  const [mailAiEnabled, setMailAiEnabledState] = useState(() => isMailAiEnabled({ storage, envValue }));
  const [mailAiConsentOpen, setMailAiConsentOpen] = useState(false);
  const smartReplyChipsEnabled = chipsEnabled ?? isMailSmartReplyChipsEnabled({ storage });
  const mailAiSmartRepliesActive = Boolean(smartReplyChipsEnabled) && mailAiEnabled;

  const handleMailAiEnabledChange = useCallback((nextEnabled) => {
    const resolved = setMailAiEnabled(Boolean(nextEnabled), { storage });
    setMailAiEnabledState(resolved);
    setMailAiConsentOpen(false);
  }, [storage]);

  const openMailAiConsentDialog = useCallback(() => {
    setMailAiConsentOpen(true);
  }, []);

  const closeMailAiConsentDialog = useCallback(() => {
    setMailAiConsentOpen(false);
  }, []);

  const confirmMailAiConsent = useCallback(() => {
    handleMailAiEnabledChange(true);
  }, [handleMailAiEnabledChange]);

  return {
    mailAiEnabled,
    mailAiConsentOpen,
    mailAiSmartRepliesActive,
    handleMailAiEnabledChange,
    openMailAiConsentDialog,
    closeMailAiConsentDialog,
    confirmMailAiConsent,
  };
}
