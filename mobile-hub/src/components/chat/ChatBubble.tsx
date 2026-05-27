import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatMessage } from '../../api/types';
import { chatTokens } from '../../theme/chatTokens';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';

export function ChatBubble({
  message,
  isOwn,
  onLongPress,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onLongPress?: () => void;
}) {
  const reactions = message.reactions || [];
  const attachment = message.attachments?.[0];
  const previewUrl = resolveAttachmentUrl(
    attachment?.url || (attachment as { preview_url?: string })?.preview_url,
  );
  const isImage = Boolean(previewUrl && String(attachment?.mime_type || '').startsWith('image/'));

  return (
    <Pressable
      onLongPress={onLongPress}
      style={[styles.wrap, isOwn ? styles.wrapOwn : styles.wrapOther]}
    >
      <View style={[styles.bubble, isOwn ? styles.own : styles.other]}>
        {message.body_text ? (
          <Text style={[styles.text, isOwn ? styles.textOwn : styles.textOther]}>
            {message.body_text}
          </Text>
        ) : null}
        {isImage && previewUrl ? (
          <Pressable onPress={() => Linking.openURL(previewUrl)}>
            <Image source={{ uri: previewUrl }} style={styles.image} resizeMode="cover" />
          </Pressable>
        ) : null}
        {attachment && !isImage ? (
          <Pressable
            onPress={() => {
              const url = resolveAttachmentUrl(attachment.url);
              if (url) Linking.openURL(url);
            }}
          >
            <Text style={styles.attachment}>📎 {attachment.file_name || 'Вложение'}</Text>
          </Pressable>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={[styles.meta, isOwn ? styles.metaOwn : styles.metaOther]}>
            {message.created_at
              ? new Date(message.created_at).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </Text>
          {isOwn ? <Text style={[styles.meta, styles.metaOwn]}> ✓</Text> : null}
        </View>
      </View>
      {reactions.length > 0 ? (
        <View style={styles.reactions}>
          {reactions.map((reaction) => (
            <Text key={reaction.emoji} style={styles.reaction}>
              {reaction.emoji} {reaction.count}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 4, maxWidth: '86%' },
  wrapOwn: { alignSelf: 'flex-end' },
  wrapOther: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, overflow: 'hidden' },
  own: { backgroundColor: chatTokens.bubbleOwnBg },
  other: { backgroundColor: chatTokens.bubbleOtherBg },
  text: { fontSize: 16, lineHeight: 22 },
  textOwn: { color: chatTokens.bubbleOwnText },
  textOther: { color: chatTokens.bubbleOtherText },
  image: { width: 220, height: 160, borderRadius: 10, marginTop: 6 },
  attachment: { marginTop: 6, fontSize: 14, color: chatTokens.composerActionBg, fontWeight: '600' },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  meta: { fontSize: 11 },
  metaOwn: { color: chatTokens.bubbleOwnMetaText },
  metaOther: { color: chatTokens.bubbleOtherMetaText },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reaction: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
  },
});
