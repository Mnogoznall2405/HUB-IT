import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as chatApi from '../../api/chatApi';
import {
  extractFirstChatUrl,
  hasUsableLinkPreview,
  type ChatLinkPreviewData,
} from '../../chat/chatLinkPreview';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

const previewCache = new Map<string, ChatLinkPreviewData | null>();

export function ChatLinkPreviewCard({
  text,
  isOwn,
}: {
  text?: string | null;
  isOwn: boolean;
}) {
  const { styles } = useChatStyles(createStyles);
  const url = extractFirstChatUrl(text);
  const [preview, setPreview] = useState<ChatLinkPreviewData | null | undefined>(
    url && previewCache.has(url) ? previewCache.get(url) : undefined,
  );

  useEffect(() => {
    if (!url) return undefined;
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url));
      return undefined;
    }
    let cancelled = false;
    void chatApi.getLinkPreview(url)
      .then((data) => {
        const next = hasUsableLinkPreview(data) ? data : null;
        previewCache.set(url, next);
        if (!cancelled) setPreview(next);
      })
      .catch(() => {
        previewCache.set(url, null);
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url || !preview || !hasUsableLinkPreview(preview)) return null;
  const image = String(preview.image || '').startsWith('https://') ? preview.image : null;

  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation();
        void Linking.openURL(url);
      }}
      style={[styles.card, isOwn ? styles.cardOwn : styles.cardOther]}
      accessibilityRole="link"
      accessibilityLabel={`Открыть ссылку ${preview.title || preview.site_name || url}`}
    >
      {image ? <Image source={{ uri: image }} style={styles.image} /> : null}
      {preview.site_name ? <Text style={styles.site} numberOfLines={1}>{preview.site_name}</Text> : null}
      {preview.title ? <Text style={styles.title} numberOfLines={2}>{preview.title}</Text> : null}
      {preview.description ? (
        <Text style={styles.description} numberOfLines={2}>{preview.description}</Text>
      ) : null}
    </Pressable>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  card: {
    minWidth: 196,
    marginTop: 6,
    padding: 8,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  cardOwn: { backgroundColor: 'rgba(95,143,78,0.12)' },
  cardOther: { backgroundColor: chatTokens.sidebarSearchBg },
  image: { width: '100%', height: 96, borderRadius: 8, marginBottom: 6 },
  site: { color: chatTokens.accentText, fontSize: 11, fontWeight: '700' },
  title: { marginTop: 2, color: chatTokens.textPrimary, fontSize: 14, fontWeight: '700' },
  description: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 12, lineHeight: 16 },
});
