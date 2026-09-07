import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { isValidMailRecipient, splitMailRecipients } from '../../mail/nativeMailModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export function recipientInputValue(values: string[]): string {
  return values.length ? `${values.join('; ')}; ` : '';
}

export function NativeMailRecipientInput({ disabled = false, label, value, tokens, testID, rightAction, onFocus, onChangeText }: {
  disabled?: boolean; label: string; value: string; tokens: FluentTokens; testID?: string;
  rightAction?: React.ReactNode; onFocus: () => void; onChangeText: (value: string) => void;
}) {
  const input = useRef<TextInput>(null);
  const parts = value.split(/[;,\n]/);
  const draft = parts.pop() || '';
  const recipients = splitMailRecipients(parts.join(';'));
  const update = (items: string[], tail = '') => onChangeText(`${recipientInputValue(items)}${tail}`);
  const commit = () => {
    if (!disabled && draft.trim()) update(splitMailRecipients(value));
  };
  return <View style={styles.field}>
    <View style={styles.heading}><Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>{rightAction}</View>
    <View style={[styles.box, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      {recipients.map((address, index) => {
        const valid = isValidMailRecipient(address);
        return <View key={`${index}:${address}`} style={[styles.chip, { borderColor: valid ? tokens.borderSoft : tokens.error }]}>
          <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Изменить адрес ${address}`}
            accessibilityHint={valid ? undefined : 'Некорректный адрес. Исправьте перед отправкой.'}
            accessibilityState={{ disabled }} style={styles.address}
            onPress={() => {
              if (disabled) return;
              update([...recipients.filter((_, position) => position !== index), ...splitMailRecipients(draft)], address);
              onFocus();
              input.current?.focus();
            }}>
            <Text style={{ color: valid ? tokens.textPrimary : tokens.error }}>{address}</Text>
            {!valid ? <Text style={{ color: tokens.error }}>Проверьте адрес</Text> : null}
          </Pressable>
          <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Удалить адрес ${address}`}
            accessibilityState={{ disabled }} style={styles.remove}
            onPress={() => { if (!disabled) update(recipients.filter((_, position) => position !== index), draft); }}>
            <Text style={{ color: tokens.textSecondary, fontSize: 22 }}>×</Text>
          </Pressable>
        </View>;
      })}
      <TextInput ref={input} editable={!disabled} testID={testID} value={draft.trimStart()}
        onFocus={onFocus} onBlur={commit} onSubmitEditing={commit} submitBehavior="submit"
        onChangeText={(text) => { if (!disabled) update(recipients, text); }}
        autoCapitalize="none" autoCorrect={false} keyboardType="email-address" returnKeyType="done"
        accessibilityLabel={label} placeholder="Добавить адрес" placeholderTextColor={tokens.textTertiary}
        style={[styles.input, { color: tokens.textPrimary }]} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  field: { marginBottom: 4 },
  heading: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { marginBottom: 5, fontSize: 12, fontWeight: '800' },
  box: { borderWidth: 1, borderRadius: 12, padding: 6, gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
  address: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  remove: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 44, paddingHorizontal: 6, fontSize: 15 },
});
