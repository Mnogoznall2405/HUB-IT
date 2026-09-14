import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import type { FluentTokens } from '../../theme/fluentTokens';

export type NativeMyFilePreviewState = {
  kind: 'image' | 'text';
  fileName: string;
  imageUri?: string;
  text?: string;
} | null;

export function NativeMyFilePreviewModal({
  preview,
  tokens,
  onClose,
}: {
  preview: NativeMyFilePreviewState;
  tokens: FluentTokens;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const imageHeight = Math.min(560, Math.max(120, (height - (insets?.top || 0) - (insets?.bottom || 0)) * 0.5));
  return (
    <Modal
      visible={Boolean(preview)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.72)',
          paddingTop: Math.max(12, (insets?.top || 0) + 12), paddingBottom: Math.max(12, (insets?.bottom || 0) + 12),
          paddingLeft: Math.max(16, (insets?.left || 0) + 12), paddingRight: Math.max(16, (insets?.right || 0) + 12) }]}
        accessibilityViewIsModal
      >
        <View style={[styles.dialog, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <View style={styles.header}>
            <View style={styles.titleBody}>
              <Text style={[styles.eyebrow, { color: tokens.textSecondary }]}>Безопасный предпросмотр</Text>
              <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{preview?.fileName || 'Файл'}</Text>
            </View>
            <Pressable
              testID="native-my-file-preview-close"
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть предпросмотр"
              style={({ pressed }) => [styles.close, { backgroundColor: tokens.panelInset, opacity: pressed ? 0.72 : 1 }]}
            >
              <MaterialCommunityIcons name="close" size={22} color={tokens.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={styles.contentScroll} contentContainerStyle={styles.content}>
          {preview?.kind === 'image' && preview.imageUri ? (
            <View style={[styles.imageStage, { height: imageHeight, backgroundColor: tokens.panelInset }]}>
              <Image
                testID="native-my-file-preview-image"
                source={{ uri: preview.imageUri }}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel={`Предпросмотр файла ${preview.fileName}`}
                style={styles.image}
              />
            </View>
          ) : null}

          {preview?.kind === 'text' ? (
            <View
              testID="native-my-file-preview-text"
              style={[styles.textContent, { backgroundColor: tokens.panelInset }]}
            >
              <Text selectable style={[styles.code, { color: tokens.textPrimary }]}>{preview.text || 'Файл пуст.'}</Text>
            </View>
          ) : null}

          <Text style={[styles.securityNote, { color: tokens.textTertiary }]}>
            Содержимое показано без выполнения HTML, JavaScript и внешних ресурсов.
          </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingHorizontal: 16, paddingVertical: 28, justifyContent: 'center' },
  dialog: { maxHeight: '100%', borderRadius: 20, borderWidth: 1, padding: 14, gap: 12 },
  header: { flexDirection: 'row', flexShrink: 0, alignItems: 'flex-start', gap: 12 },
  titleBody: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase' },
  title: { marginTop: 2, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  contentScroll: { flexShrink: 1 },
  content: { gap: 12 },
  imageStage: { borderRadius: 13, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  textContent: { padding: 14, borderRadius: 13 },
  code: { fontSize: 13, lineHeight: 19, fontFamily: 'monospace' },
  securityNote: { fontSize: 11, lineHeight: 15 },
});
