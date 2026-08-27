import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import type { NativeAttachmentSource } from '../../files/nativeFilePicker';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

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
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const options: Array<{ source: NativeAttachmentSource; icon: string; label: string }> = [
    { source: 'camera', icon: '📷', label: 'Камера' },
    { source: 'gallery', icon: '🖼', label: 'Фото из галереи' },
    { source: 'document', icon: '📎', label: 'Файл' },
  ];

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть выбор вложения"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title}>Добавить вложение</Text>
          {options.map((option) => (
            <Pressable
              key={option.source}
              onPress={() => onPick(option.source)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={option.label}
            >
              <Text style={styles.icon}>{option.icon}</Text>
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
              <Text style={styles.icon}>☑</Text>
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
              <Text style={styles.icon}>🙂</Text>
              <Text style={styles.label}>Стикер</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Отмена"
          >
            <Text style={styles.label}>Отмена</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 20,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: chatTokens.panelBg,
  },
  title: {
    marginHorizontal: 12,
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
  icon: { width: 28, fontSize: 22, textAlign: 'center' },
  label: { color: chatTokens.textPrimary, fontSize: 16, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.96 }], backgroundColor: chatTokens.sidebarRowSoftActive },
});
