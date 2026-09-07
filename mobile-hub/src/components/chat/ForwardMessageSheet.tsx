import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useContext, useEffect, useMemo, useState } from 'react';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { russianPlural } from '../../utils/russianPlural';
import type { ChatConversationSummary, ChatMessage } from '../../api/types';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

export function ForwardMessageSheet({
  message,
  count = 1,
  conversations,
  busy,
  status = '',
  error = '',
  onClose,
  onForward,
}: {
  message: ChatMessage | null;
  count?: number;
  conversations: ChatConversationSummary[];
  busy: boolean;
  status?: string;
  error?: string;
  onClose: () => void;
  onForward: (conversation: ChatConversationSummary) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const visible = Boolean(message);
  useEffect(() => { if (!visible) setQuery(''); }, [visible]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((item) => String(item.title || '').toLowerCase().includes(normalized));
  }, [conversations, query]);

  return (
    <Modal
      visible={Boolean(message)}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={() => { if (!busy) onClose(); }}
    >
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть пересылку"
          disabled={busy}
        />
        <View testID="chat-forward-sheet" style={[styles.sheet, {
          paddingBottom: Math.max(20, insets?.bottom || 0),
          paddingLeft: 12 + (insets?.left || 0), paddingRight: 12 + (insets?.right || 0),
        }]} accessibilityViewIsModal>
          <Text style={styles.title}>
            {count > 1 ? `Переслать ${count} ${russianPlural(count, ['сообщение', 'сообщения', 'сообщений'])}` : 'Переслать сообщение'}
          </Text>
          {status ? <Text accessibilityLiveRegion="polite" style={styles.preview}>{status}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
          {busy ? <Text accessibilityLiveRegion="polite" style={styles.preview}>Пересылаем…</Text> : null}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Найти диалог"
            placeholderTextColor={chatTokens.textSecondary}
            style={styles.search}
            accessibilityLabel="Поиск диалога для пересылки"
          />
          {query ? <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Очистить поиск диалога"
            onPress={() => setQuery('')} style={styles.cancel}><Text style={styles.cancelText}>Очистить поиск</Text></Pressable> : null}
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {filtered.map((conversation) => (
              <Pressable
                key={conversation.id}
                onPress={() => onForward(conversation)}
                disabled={busy}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Переслать в ${conversation.title || 'диалог'}`}
                accessibilityState={{ disabled: busy }}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>{conversation.title || 'Диалог'}</Text>
                <Text style={styles.preview} numberOfLines={1}>{conversation.last_message_preview || 'Нет сообщений'}</Text>
              </Pressable>
            ))}
            {!filtered.length ? <Text style={styles.empty}>Диалоги не найдены</Text> : null}
          </ScrollView>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Отмена"
            disabled={busy}
            accessibilityState={{ disabled: busy }}
          >
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    maxHeight: '78%',
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 20,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: chatTokens.panelBg,
  },
  title: { marginHorizontal: 8, marginBottom: 10, color: chatTokens.textPrimary, fontSize: 17, fontWeight: '700' },
  search: {
    minHeight: 44,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    color: chatTokens.textPrimary,
    backgroundColor: chatTokens.sidebarSearchBg,
    fontSize: 15,
  },
  list: { maxHeight: 360 },
  row: { minHeight: 58, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10 },
  pressed: { transform: [{ scale: 0.96 }], backgroundColor: chatTokens.sidebarRowSoftActive },
  rowTitle: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  preview: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 13 },
  notice: { marginVertical: 10, color: chatTokens.textPrimary, fontSize: 14, lineHeight: 20 },
  empty: { paddingVertical: 24, color: chatTokens.textSecondary, textAlign: 'center' },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  cancelText: { color: chatTokens.accentText, fontSize: 16, fontWeight: '700' },
});
