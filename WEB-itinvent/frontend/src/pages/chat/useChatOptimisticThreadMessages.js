import { useCallback } from 'react';

import {
  buildOptimisticFileMessage,
  buildOptimisticStickerMessage,
  buildOptimisticTextMessage,
  buildReplyPreview,
  isLikelyOptimisticReplacement,
  revokeOptimisticObjectUrls,
  withStableThreadMessageRenderKey,
} from './chatOptimisticMessages';

export default function useChatOptimisticThreadMessages({
  optimisticMessageSeqRef,
  user,
}) {
  const withStableMessageRenderKey = useCallback(
    (message, existingMessage = null) => withStableThreadMessageRenderKey(message, existingMessage),
    [],
  );

  const createOptimisticTextMessage = useCallback(({ conversationId, body, bodyFormat = 'plain', replyPreview }) => {
    optimisticMessageSeqRef.current += 1;
    return buildOptimisticTextMessage({
      conversationId,
      body,
      bodyFormat,
      replyPreview,
      user,
      seq: optimisticMessageSeqRef.current,
    });
  }, [optimisticMessageSeqRef, user?.full_name, user?.id, user?.username]);

  const createOptimisticFileMessage = useCallback(({
    conversationId,
    files,
    mediaKinds,
    mediaDimensions,
    body,
    replyPreview,
  }) => {
    optimisticMessageSeqRef.current += 1;
    return buildOptimisticFileMessage({
      conversationId,
      files,
      mediaKinds,
      mediaDimensions,
      body,
      replyPreview,
      user,
      seq: optimisticMessageSeqRef.current,
    });
  }, [optimisticMessageSeqRef, user?.full_name, user?.id, user?.username]);

  const createOptimisticStickerMessage = useCallback(({
    conversationId,
    sticker,
    replyPreview,
  }) => {
    optimisticMessageSeqRef.current += 1;
    return buildOptimisticStickerMessage({
      conversationId,
      sticker,
      replyPreview,
      user,
      seq: optimisticMessageSeqRef.current,
    });
  }, [optimisticMessageSeqRef, user?.full_name, user?.id, user?.username]);

  const revokeObjectUrls = useCallback((urls) => {
    revokeOptimisticObjectUrls(urls);
  }, []);

  return {
    buildReplyPreview,
    createOptimisticFileMessage,
    createOptimisticStickerMessage,
    createOptimisticTextMessage,
    isLikelyOptimisticReplacement,
    revokeObjectUrls,
    withStableMessageRenderKey,
  };
}
