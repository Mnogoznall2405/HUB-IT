import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChatMessage } from '../../api/types';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

export function ChatMessageSearch({
  query,
  onChangeQuery,
  onSubmit,
  onClose,
  results,
  loading,
  searched,
  onSelect,
}: {
  query: string;
  onChangeQuery: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  results: ChatMessage[];
  loading: boolean;
  searched: boolean;
  onSelect: (message: ChatMessage) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  return (
    <View style={styles.panel}>
      <View style={styles.inputRow}>
        <TextInput
          value={query}
          onChangeText={onChangeQuery}
          onSubmitEditing={onSubmit}
          placeholder="Поиск в диалоге"
          placeholderTextColor={chatTokens.textSecondary}
          style={styles.input}
          accessibilityLabel="Поиск сообщений в диалоге"
          returnKeyType="search"
          autoFocus
        />
        <Pressable
          onPress={onSubmit}
          disabled={!query.trim() || loading}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Найти сообщения"
          accessibilityState={{ disabled: !query.trim() || loading }}
        >
          {loading ? <ActivityIndicator size="small" color={chatTokens.composerActionBg} /> : <Text style={styles.icon}>⌕</Text>}
        </Pressable>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Закрыть поиск"
        >
          <Text style={styles.icon}>×</Text>
        </Pressable>
      </View>
      {results.length > 0 ? (
        <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
          {results.map((message) => (
            <Pressable
              key={message.id}
              onPress={() => onSelect(message)}
              style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Перейти к сообщению: ${message.body_text || 'Вложение'}`}
            >
              <Text style={styles.sender} numberOfLines={1}>
                {message.sender?.full_name || message.sender?.username || 'Участник'}
              </Text>
              <Text style={styles.body} numberOfLines={2}>{message.body_text || 'Вложение'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : searched && !loading ? (
        <Text style={styles.empty} accessibilityLiveRegion="polite">
          По вашему запросу ничего не найдено
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  panel: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: chatTokens.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.borderSoft,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    color: chatTokens.textPrimary,
    backgroundColor: chatTokens.sidebarSearchBg,
    fontSize: 15,
  },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  icon: { color: chatTokens.textPrimary, fontSize: 25 },
  pressed: { transform: [{ scale: 0.96 }], backgroundColor: chatTokens.sidebarRowSoftActive },
  results: { maxHeight: 180, marginTop: 8 },
  result: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  resultPressed: { backgroundColor: chatTokens.sidebarRowSoftActive },
  sender: { color: chatTokens.accentText, fontSize: 12, fontWeight: '700' },
  body: { marginTop: 2, color: chatTokens.textPrimary, fontSize: 14, lineHeight: 18 },
  empty: {
    paddingHorizontal: 10,
    paddingVertical: 14,
    color: chatTokens.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
