import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { NativeAttachmentSource } from '../../files/nativeFilePicker';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatBottomSheet } from './ChatBottomSheet';

export function AttachmentPickerSheet({
  visible,
  onClose,
  onPick,
  onTask,
  onSticker,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (source: NativeAttachmentSource) => void;
  onTask?: () => void;
  onSticker?: () => void;
}) {
  const { styles, chatTokens } = useChatStyles(createStyles);
  const options: Array<{ source: NativeAttachmentSource; icon: string; label: string }> = [
    { source: 'camera', icon: 'camera-outline', label: 'Камера' },
    { source: 'gallery', icon: 'image-multiple-outline', label: 'Фото из галереи' },
    { source: 'document', icon: 'file-outline', label: 'Файл' },
  ];

  return (
    <ChatBottomSheet
      visible={visible}
      onClose={onClose}
      dismissAccessibilityLabel="Закрыть выбор вложения"
      sheetStyle={styles.sheet}
    >
      <Text style={styles.title}>Добавить вложение</Text>
      {options.map((option) => (
        <Pressable
          key={option.source}
          onPress={() => onPick(option.source)}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={option.label}
        >
          <MaterialCommunityIcons name={option.icon as never} size={24} color={chatTokens.textPrimary} style={styles.icon} />
          <Text style={styles.label}>{option.label}</Text>
        </Pressable>
      ))}
      {onTask ? (
        <Pressable
          onPress={onTask}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Отправить задачу"
        >
          <MaterialCommunityIcons name="clipboard-check-outline" size={24} color={chatTokens.textPrimary} style={styles.icon} />
          <Text style={styles.label}>Задача</Text>
        </Pressable>
      ) : null}
      {onSticker ? (
        <Pressable
          onPress={onSticker}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Открыть стикеры"
        >
          <MaterialCommunityIcons name="sticker-emoji" size={24} color={chatTokens.textPrimary} style={styles.icon} />
          <Text style={styles.label}>Стикер</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.option, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Отмена"
      >
        <MaterialCommunityIcons name="close" size={24} color={chatTokens.textSecondary} style={styles.icon} />
        <Text style={[styles.label, { color: chatTokens.textSecondary }]}>Отмена</Text>
      </Pressable>
    </ChatBottomSheet>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  sheet: {
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  title: {
    marginHorizontal: 12,
    marginTop: 2,
    marginBottom: 8,
    color: chatTokens.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  icon: { width: 28, textAlign: 'center' },
  label: { color: chatTokens.textPrimary, fontSize: 16, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.96 }], backgroundColor: chatTokens.sidebarRowSoftActive },
});
