import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  tokens,
  onChangeText,
  onSend,
}: {
  testID: string;
  inputTestID: string;
  sendTestID: string;
  value: string;
  busy: boolean;
  disabled: boolean;
  placeholder: string;
  status?: string;
  tokens: FluentTokens;
  onChangeText: (value: string) => void;
  onSend: () => void;
}) {
  const cannotSend = busy || disabled || !value.trim();
  return (
    <View
      testID={testID}
      style={[styles.bar, { backgroundColor: tokens.headerBandBg, borderTopColor: tokens.borderSoft }]}
    >
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[
            styles.status,
            { color: tokens.success, backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft },
          ]}
        >
          {status}
        </Text>
      ) : null}
      <View style={[styles.inputShell, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="pencil-outline" size={18} color={tokens.textSecondary} />
        <TextInput
          testID={inputTestID}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={() => {
            if (!cannotSend) onSend();
          }}
          editable={!busy && !disabled}
          multiline={false}
          returnKeyType="send"
          autoCapitalize="sentences"
          placeholder={placeholder}
          placeholderTextColor={tokens.textTertiary}
          accessibilityLabel="Текст быстрого ответа"
          style={[styles.input, { color: tokens.textPrimary }]}
        />
      </View>
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
            backgroundColor: tokens.primary,
            opacity: cannotSend ? 0.5 : pressed ? 0.88 : 1,
            transform: [{ scale: pressed && !cannotSend ? 0.96 : 1 }],
          },
        ]}
      >
        {busy ? <ActivityIndicator size="small" color="#fff" /> : <MaterialCommunityIcons name="send" size={18} color="#fff" />}
        <Text style={styles.sendText}>{busy ? 'Отправка…' : 'Отправить'}</Text>
      </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputShell: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontSize: 14,
    lineHeight: 20,
  },
  send: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sendText: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  status: {
    position: 'absolute',
    right: 12,
    bottom: '100%',
    marginBottom: 6,
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
