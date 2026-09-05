import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChatSticker } from '../../api/types';
import {
  pickStickerImageUrl,
  pickStickerPlaybackUrl,
  stickerAnimationKind,
  stickerEmojiLabel,
} from '../../chat/chatStickers';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';
import { ChatAnimatedSticker } from './ChatAnimatedSticker';

type StickerImageModel = Pick<ChatSticker, 'id' | 'emoji' | 'preview_url' | 'file_url' | 'mime_type' | 'format'> & {
  variant_urls?: Record<string, string>;
  original_url?: string | null;
  download_url?: string | null;
  url?: string | null;
  file_name?: string | null;
};

export const ChatStickerImage = memo(function ChatStickerImage({
  sticker,
  size = 88,
  label,
  autoPlay = false,
}: {
  sticker: StickerImageModel;
  size?: number;
  label?: string;
  autoPlay?: boolean;
}) {
  const { styles } = useChatStyles(createStyles);
  const remoteUrl = resolveAttachmentUrl(pickStickerImageUrl(sticker));
  const playbackUrl = resolveAttachmentUrl(pickStickerPlaybackUrl(sticker));
  const animationKind = stickerAnimationKind(sticker);
  const emoji = stickerEmojiLabel(sticker.emoji);
  const accessibilityLabel = label || `Стикер ${emoji}`.trim();
  const fallback = (
    <View style={[styles.fallback, { width: size, height: size }]} accessible accessibilityLabel={accessibilityLabel}>
      <Text style={[styles.emoji, { fontSize: Math.max(22, Math.round(size * 0.42)) }]}>
        {emoji || '🙂'}
      </Text>
    </View>
  );

  const preview = remoteUrl ? (
    <ChatAuthenticatedImage
      uri={remoteUrl}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel={accessibilityLabel}
      loadingFallback={fallback}
      errorFallback={fallback}
    />
  ) : fallback;

  if (autoPlay && playbackUrl) {
    return (
      <ChatAnimatedSticker
        uri={playbackUrl}
        mimeType={sticker.mime_type}
        animationKind={animationKind}
        size={size}
        accessibilityLabel={accessibilityLabel}
        fallback={preview}
      />
    );
  }

  return preview;
});

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  emoji: { color: chatTokens.textPrimary },
});
