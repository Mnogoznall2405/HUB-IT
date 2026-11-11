import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';
import { showNativeToast } from '../nativeToast';

export const copyIconHitSlop = 13;

export async function copyNativeFieldValue(text: string, copiedMessage: string): Promise<void> {
  const normalized = String(text ?? '').trim();
  if (!normalized) return;
  try {
    const copied = await Clipboard.setStringAsync(normalized);
    if (copied === false) throw new Error('Clipboard rejected the value');
    try { await Haptics.selectionAsync(); } catch { /* Tactile feedback is optional. */ }
    showNativeToast(copiedMessage);
  } catch {
    showNativeToast('Не удалось скопировать');
  }
}

export function NativeCopyableField({
  tokens,
  label,
  value,
  copyLabel,
  copyValue,
  copiedMessage,
  testID,
  multiline = false,
  trailing,
}: {
  tokens: FluentTokens;
  label: string;
  value?: string | null;
  copyLabel: string;
  copyValue?: string | null;
  copiedMessage?: string;
  testID: string;
  multiline?: boolean;
  trailing?: ReactNode;
}) {
  if (value === null || value === undefined) return null;
  const shown = String(value);
  const display = shown.trim();
  const copyText = String(copyValue ?? shown).trim();
  const canCopy = Boolean(copyText);
  const copy = () => { void copyNativeFieldValue(copyText, copiedMessage ?? `${copyLabel} скопирован`); };

  if (!display) {
    return (
      <View testID={testID} accessible accessibilityLabel={`${label}: не указано`} style={[styles.row, { borderBottomColor: tokens.borderSoft }]}>
        <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
        <Text style={[styles.value, { color: tokens.textPrimary }]}>—</Text>
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onLongPress={canCopy ? copy : undefined}
      accessibilityLabel={`${label}: ${display}`}
      accessibilityHint={canCopy ? 'Долгое нажатие — скопировать' : undefined}
      accessibilityActions={canCopy ? [{ name: 'copy', label: 'Скопировать' }] : undefined}
      onAccessibilityAction={canCopy ? (event) => { if (event.nativeEvent.actionName === 'copy') copy(); } : undefined}
      style={({ pressed }) => [styles.row, { borderBottomColor: tokens.borderSoft }, pressed && canCopy ? styles.rowPressed : null]}
    >
      <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      <View style={styles.valueRow}>
        <Text selectable={multiline} style={[styles.value, { color: tokens.textPrimary }]}>{shown}</Text>
        {canCopy ? (
          <Pressable
            testID={`${testID}-copy`}
            accessibilityRole="button"
            accessibilityLabel={`Скопировать: ${label}`}
            onPress={copy}
            onLongPress={copy}
            hitSlop={copyIconHitSlop}
            style={styles.copyButton}
          >
            <MaterialCommunityIcons name="content-copy" size={18} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
        {trailing}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 48, paddingVertical: 8, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { opacity: 0.72 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '600', textAlign: 'left' },
  copyButton: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
});
