import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatSocketStatus } from '../../chat/chatSocket';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';

const LABELS: Partial<Record<ChatSocketStatus, string>> = {
  connecting: 'Подключение к Chat…',
  reconnecting: 'Восстанавливаем соединение…',
  offline: 'Chat сейчас offline',
  suspended: 'Соединение приостановлено в фоне',
  error: 'Ошибка соединения с Chat',
};

export function ChatConnectionBanner({
  status,
  onRetry,
}: {
  status: ChatSocketStatus;
  onRetry: () => void;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const label = LABELS[status];
  if (!label) return null;
  const retryable = status === 'offline' || status === 'error';
  return (
    <View style={styles.banner} accessible accessibilityLiveRegion="polite">
      <Text style={styles.text}>{label}</Text>
      {retryable ? (
        <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  banner: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: chatTokens.warningBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
  },
  text: { flex: 1, color: chatTokens.textPrimary, fontSize: 13 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  retryText: { color: chatTokens.warningText, fontWeight: '700' },
});
