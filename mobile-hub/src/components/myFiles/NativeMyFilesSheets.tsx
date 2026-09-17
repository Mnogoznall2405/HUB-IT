import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MyFileFolder } from '../../api/myFilesApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal } from '../ui/NativeModal';
import { NativeSheetHeader } from '../ui/NativeFilterControls';

export type MyFilesSheetAction = {
  key: string;
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
  testID?: string;
  onPress: () => void;
};

export function NativeMyFilesActionSheet({
  title,
  actions,
  tokens,
  onClose,
}: {
  title: string;
  actions: MyFilesSheetAction[];
  tokens: FluentTokens;
  onClose: () => void;
}) {
  return (
    <NativeModal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть" accessibilityRole="button" />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <NativeSheetHeader title={title} tokens={tokens} onClose={onClose} />
          <ScrollView style={styles.actionsScroll} keyboardShouldPersistTaps="handled">
            {actions.map((action) => (
              <Pressable
                key={action.key}
                testID={action.testID}
                disabled={action.disabled || action.busy}
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: action.disabled || action.busy, busy: action.busy, selected: action.selected }}
                style={({ pressed }) => [
                  styles.actionRow,
                  { borderColor: tokens.borderSoft, opacity: action.disabled ? 0.5 : pressed ? 0.7 : 1 },
                ]}
              >
                {action.busy
                  ? <ActivityIndicator size="small" color={action.danger ? tokens.error : tokens.primary} />
                  : <MaterialCommunityIcons name={action.icon} size={20} color={action.danger ? tokens.error : action.selected ? tokens.primary : tokens.textPrimary} />}
                <Text style={[styles.actionLabel, { color: action.danger ? tokens.error : action.selected ? tokens.primary : tokens.textPrimary }]}>
                  {action.label}
                </Text>
                {action.selected ? <MaterialCommunityIcons name="check" size={19} color={tokens.primary} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </NativeModal>
  );
}

export function NativeMyFilesPromptSheet({
  visible,
  title,
  placeholder,
  initialValue = '',
  submitLabel,
  tokens,
  busy = false,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  initialValue?: string;
  submitLabel: string;
  tokens: FluentTokens;
  busy?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [initialValue, visible]);

  const submit = () => {
    const next = value.trim();
    if (!next || busy) return;
    onSubmit(next);
  };

  return (
    <NativeModal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} disabled={busy} accessibilityState={{ disabled: busy }} onPress={onClose} accessibilityLabel="Закрыть" accessibilityRole="button" />
        <View accessibilityViewIsModal style={[styles.promptSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <NativeSheetHeader title={title} tokens={tokens} onClose={onClose} closeDisabled={busy} />
          <View style={styles.promptBody}>
            <TextInput
              testID="native-my-files-prompt-input"
              value={value}
              editable={!busy}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={tokens.textTertiary}
              autoFocus
              maxLength={255}
              accessibilityLabel={title}
              onSubmitEditing={submit}
              style={[styles.promptInput, { borderColor: tokens.borderSoft, color: tokens.textPrimary, backgroundColor: tokens.panelInset }]}
            />
            <View style={styles.promptActions}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Отмена"
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                style={[styles.promptButton, { borderColor: tokens.borderSoft, opacity: busy ? 0.45 : 1 }]}
              >
                <Text style={{ color: tokens.textPrimary, fontWeight: '700' }}>Отмена</Text>
              </Pressable>
              <Pressable
                testID="native-my-files-prompt-submit"
                onPress={submit}
                disabled={!value.trim() || busy}
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                accessibilityState={{ disabled: !value.trim() || busy, busy }}
                style={[styles.promptButton, { borderColor: tokens.primary, backgroundColor: tokens.primary, opacity: !value.trim() || busy ? 0.55 : 1 }]}
              >
                {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text accessibilityLiveRegion="polite" style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Сохраняем…' : submitLabel}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </NativeModal>
  );
}

export function NativeMyFilesMoveSheet({
  visible,
  title,
  folders,
  currentFolderId,
  excludeFolderId,
  tokens,
  busy = false,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  folders: MyFileFolder[];
  currentFolderId: string | null;
  excludeFolderId?: string | null;
  tokens: FluentTokens;
  busy?: boolean;
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const depth = (folder: MyFileFolder): number => {
    let level = 0;
    let parent = folder.parent_id;
    const guard = new Set<string>();
    while (parent && !guard.has(parent)) {
      guard.add(parent);
      const next = folders.find((entry) => entry.id === parent);
      if (!next) break;
      level += 1;
      parent = next.parent_id;
    }
    return level;
  };
  const sorted = [...folders]
    .filter((folder) => folder.id !== excludeFolderId)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return (
    <NativeModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть" accessibilityRole="button" />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <NativeSheetHeader title={title} tokens={tokens} onClose={onClose} />
          <ScrollView style={styles.actionsScroll} keyboardShouldPersistTaps="handled">
            <Pressable
              testID="native-my-files-move-root"
              disabled={busy}
              onPress={() => onSelect(null)}
              accessibilityRole="button"
              accessibilityLabel="Переместить в корень"
              accessibilityState={{ selected: currentFolderId === null, disabled: busy }}
              style={({ pressed }) => [styles.moveRow, { borderColor: tokens.borderSoft, opacity: pressed ? 0.7 : 1 }]}
            >
              <MaterialCommunityIcons name="home-outline" size={20} color={currentFolderId === null ? tokens.primary : tokens.textPrimary} />
              <Text style={[styles.actionLabel, { color: currentFolderId === null ? tokens.primary : tokens.textPrimary }]}>Все файлы (корень)</Text>
            </Pressable>
            {sorted.map((folder) => (
              <Pressable
                key={folder.id}
                testID={`native-my-files-move-folder-${folder.id}`}
                disabled={busy}
                onPress={() => onSelect(folder.id)}
                accessibilityRole="button"
                accessibilityLabel={`Переместить в папку ${folder.name}`}
                accessibilityState={{ selected: currentFolderId === folder.id, disabled: busy }}
                style={({ pressed }) => [
                  styles.moveRow,
                  { borderColor: tokens.borderSoft, paddingLeft: 12 + depth(folder) * 18, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <MaterialCommunityIcons name="folder-outline" size={20} color={currentFolderId === folder.id ? tokens.primary : tokens.textPrimary} />
                <Text numberOfLines={1} style={[styles.actionLabel, { color: currentFolderId === folder.id ? tokens.primary : tokens.textPrimary }]}>{folder.name}</Text>
                {currentFolderId === folder.id ? <MaterialCommunityIcons name="check" size={18} color={tokens.primary} /> : null}
              </Pressable>
            ))}
            {!sorted.length ? (
              <Text style={[styles.emptyMove, { color: tokens.textSecondary }]}>Папок пока нет — файл останется в корне.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    paddingBottom: 14,
  },
  actionsScroll: { paddingHorizontal: 12, paddingTop: 6 },
  actionRow: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionLabel: { flex: 1, fontSize: 14, fontWeight: '700' },
  moveRow: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyMove: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  promptSheet: {
    marginHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    paddingBottom: 14,
  },
  promptBody: { paddingHorizontal: 16, paddingTop: 10 },
  promptInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  promptButton: {
    minHeight: 44,
    minWidth: 96,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
