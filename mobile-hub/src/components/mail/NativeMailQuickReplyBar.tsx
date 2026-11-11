import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';

export function NativeMailQuickReplyBar({
  testID,
  inputTestID,
  sendTestID,
  value,
  busy,
  disabled,
  placeholder,
  status = '',
  error = '',
  tokens,
  onChangeText,
  onSend,
  onExpand,
  pending = false,
  onResolve,
  onReview,
  restoring = false,
  onRetryRestore,
  embedded = false,
  onCollapse,
}: {
  testID: string;
  inputTestID: string;
  sendTestID: string;
  value: string;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  status?: string;
  error?: string;
  tokens: FluentTokens;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onExpand?: () => void;
  pending?: boolean;
  onResolve?: (wasSent: boolean) => void;
  onReview?: () => void;
  restoring?: boolean;
  onRetryRestore?: () => void;
  embedded?: boolean;
  onCollapse?: () => void;
}) {
  const cannotSend = busy || disabled || !value.trim();
  return (
    <View
      testID={testID}
      style={[styles.bar, embedded ? styles.barEmbedded : { backgroundColor: tokens.headerBandBg, borderTopColor: tokens.borderSoft }]}
    >
      {restoring ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>Восстановление черновика…</Text> : null}
      {onRetryRestore ? <Pressable accessibilityRole="button" onPress={onRetryRestore} style={styles.expand}><Text style={{ color: tokens.primary }}>Повторить восстановление</Text></Pressable> : null}
      {pending && !busy ? <View style={{ gap: 4 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>Результат отправки не подтверждён. Проверьте «Отправленные» перед повтором.</Text>
        <View style={styles.actions}>
          {onReview ? <Pressable accessibilityRole="button" onPress={onReview} style={styles.expand}><Text style={{ color: tokens.primary }}>Проверить отправленные</Text></Pressable> : null}
          {onResolve ? <Pressable accessibilityRole="button" onPress={() => Alert.alert('Письмо найдено в отправленных?', 'Если письмо ещё доставляется, новый ответ может создать дубликат. Завершайте проверку только после проверки папки «Отправленные».', [
            { text: 'Вернуться', style: 'cancel' },
            { text: 'Да, ответ отправлен', onPress: () => onResolve(true) },
            { text: 'Нет, редактировать ответ', onPress: () => onResolve(false) },
          ])} style={styles.expand}><Text style={{ color: tokens.primary }}>Завершить проверку</Text></Pressable> : null}
        </View>
      </View> : null}
      {error || status ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={error ? 'alert' : undefined}
          pointerEvents="none"
          style={[
            styles.status,
            { color: error ? tokens.error : tokens.success, backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft },
          ]}
        >
          {error || status}
        </Text>
      ) : null}
      <View style={[styles.inputShell, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="reply-outline" size={18} color={tokens.textSecondary} />
        <TextInput
          testID={inputTestID}
          value={value}
          onChangeText={onChangeText}
          editable={!busy && !disabled && !pending}
          multiline
          submitBehavior="newline"
          returnKeyType="default"
          autoCapitalize="sentences"
          placeholder={placeholder}
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Текст быстрого ответа"
          style={[styles.input, { color: tokens.textPrimary }]}
        />
        {onCollapse ? <Pressable
          accessibilityRole="button"
          accessibilityLabel="Скрыть панель быстрого ответа"
          onPress={onCollapse}
          hitSlop={6}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.7 : 1 }]}
        ><MaterialCommunityIcons name="chevron-down" size={20} color={tokens.iconMuted} /></Pressable> : null}
        {onExpand ? <Pressable
          accessibilityRole="button"
          accessibilityLabel="Открыть полный редактор ответа"
          disabled={busy || disabled || pending}
          accessibilityState={{ disabled: busy || disabled || pending }}
          onPress={onExpand}
          hitSlop={6}
          style={({ pressed }) => [styles.iconButton, { opacity: busy || disabled || pending ? 0.4 : pressed ? 0.7 : 1 }]}
        ><MaterialCommunityIcons name="arrow-expand" size={19} color={tokens.textSecondary} /></Pressable> : null}
        <Pressable
          testID={sendTestID}
          accessibilityRole="button"
          accessibilityLabel="Отправить быстрый ответ"
          accessibilityState={{ disabled: cannotSend, busy }}
          disabled={cannotSend}
          onPress={onSend}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: cannotSend ? tokens.panelInset : tokens.primary,
              opacity: cannotSend ? 1 : pressed ? 0.88 : 1,
              transform: [{ scale: pressed && !cannotSend ? 0.94 : 1 }],
            },
          ]}
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="send" size={16} color={cannotSend ? tokens.textTertiary : '#fff'} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'relative',
    flexShrink: 0,
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  barEmbedded: {
    borderTopWidth: 0,
    backgroundColor: 'transparent',
  },
  inputShell: {
    minWidth: 0,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    maxHeight: 120,
    paddingHorizontal: 0,
    paddingVertical: 7,
    fontSize: 16,
    lineHeight: 21,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  expand: { minHeight: 44, paddingHorizontal: 8, marginRight: 'auto', flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    zIndex: 2,
  },
});
