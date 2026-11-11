import { useCallback, useState } from 'react';

export default function useMailRemoteImages() {
  const [revealedRemoteImagesByMessageId, setRevealedRemoteImagesByMessageId] = useState({});

  const revealRemoteImagesForMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return;

    setRevealedRemoteImagesByMessageId((prev) => {
      if (prev?.[normalizedMessageId]) return prev;
      return {
        ...(prev || {}),
        [normalizedMessageId]: true,
      };
    });
  }, []);

  return {
    revealedRemoteImagesByMessageId,
    revealRemoteImagesForMessage,
  };
}
