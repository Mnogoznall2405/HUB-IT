import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';

const SHUTTER_GREEN = '#2e7d32';

// Панель режима «Быстрые фото» поверх сканера: цель (техника из QR), счётчики
// и затвор. Следующий QR переключает цель, очередь отправки идёт фоном.
export const NativeScanPhotoPanel = memo(function NativeScanPhotoPanel({
  tokens,
  title,
  invNo,
  uploaded,
  pending,
  failed,
  capturing,
  onCapture,
  onRetry,
  onDiscardFailed,
  onExit,
  preview = null,
  previewEnabled = true,
  onTogglePreview,
  onPreviewRotate,
  onPreviewAccept,
  onPreviewRetake,
}: {
  tokens: FluentTokens;
  title: string;
  invNo: string;
  uploaded: number;
  pending: number;
  failed: number;
  capturing: boolean;
  onCapture: () => void;
  onRetry: () => void;
  onDiscardFailed: () => void;
  onExit: () => void;
  // Кадр, ожидающий подтверждения: можно повернуть, принять или переснять.
  preview?: { uri: string; busy: boolean } | null;
  previewEnabled?: boolean;
  onTogglePreview?: () => void;
  onPreviewRotate?: (degrees: number) => void;
  onPreviewAccept?: () => void;
  onPreviewRetake?: () => void;
}) {
  const hasTarget = Boolean(invNo);
  if (preview) {
    return (
      <View
        testID="native-scan-photo-panel"
        style={[styles.root, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}
      >
        <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>
          {`Проверьте кадр · ${title || invNo}`}
        </Text>
        <View style={styles.previewFrame}>
          <Image source={{ uri: preview.uri }} style={styles.previewImage} contentFit="contain" recyclingKey={preview.uri} />
        </View>
        <View style={styles.previewActions}>
          <Pressable
            testID="native-scan-photo-rotate-left"
            accessibilityRole="button"
            accessibilityLabel="Повернуть кадр влево"
            disabled={preview.busy}
            onPress={() => onPreviewRotate?.(-90)}
            style={[styles.roundButton, { borderColor: tokens.borderStrong }]}
          >
            <MaterialCommunityIcons name="rotate-left" size={22} color={tokens.textPrimary} />
          </Pressable>
          <Pressable
            testID="native-scan-photo-rotate-right"
            accessibilityRole="button"
            accessibilityLabel="Повернуть кадр вправо"
            disabled={preview.busy}
            onPress={() => onPreviewRotate?.(90)}
            style={[styles.roundButton, { borderColor: tokens.borderStrong }]}
          >
            <MaterialCommunityIcons name="rotate-right" size={22} color={tokens.textPrimary} />
          </Pressable>
          <View style={styles.previewSpacer} />
          <Pressable
            testID="native-scan-photo-retake"
            accessibilityRole="button"
            accessibilityLabel="Переснять кадр"
            disabled={preview.busy}
            onPress={onPreviewRetake}
            style={[styles.exit, { borderColor: tokens.borderStrong }]}
          >
            <Text style={[styles.exitText, { color: tokens.textPrimary }]}>Переснять</Text>
          </Pressable>
          <Pressable
            testID="native-scan-photo-accept"
            accessibilityRole="button"
            accessibilityLabel="Отправить кадр"
            disabled={preview.busy}
            onPress={onPreviewAccept}
            style={[styles.accept, { opacity: preview.busy ? 0.6 : 1 }]}
          >
            <Text style={styles.acceptText}>Отправить</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View
      testID="native-scan-photo-panel"
      style={[styles.root, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}
    >
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>
            {hasTarget ? title : 'Быстрые фото'}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: tokens.textSecondary }]}>
            {hasTarget ? `Инв. № ${invNo}` : 'Наведите камеру на QR техники, затем снимайте'}
          </Text>
        </View>
        <Pressable
          testID="native-scan-photo-exit"
          accessibilityRole="button"
          accessibilityLabel="Выйти из режима быстрых фото"
          onPress={onExit}
          style={[styles.exit, { borderColor: tokens.borderStrong }]}
        >
          <Text style={[styles.exitText, { color: tokens.textPrimary }]}>Готово</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.counters}>
          <Text testID="native-scan-photo-uploaded" style={[styles.counter, { color: tokens.textPrimary }]}>
            {`Загружено: ${uploaded}`}
          </Text>
          {pending > 0 ? (
            <View style={styles.pendingRow}>
              <ActivityIndicator size="small" color={tokens.primary} />
              <Text testID="native-scan-photo-pending" style={[styles.counterSmall, { color: tokens.textSecondary }]}>
                {`Отправляется: ${pending}`}
              </Text>
            </View>
          ) : null}
          {failed > 0 ? (
            <View style={styles.failedRow}>
              <Text testID="native-scan-photo-failed" accessibilityRole="alert" style={[styles.counterSmall, { color: tokens.error }]}>
                {`Не загружено: ${failed}`}
              </Text>
              <Pressable
                testID="native-scan-photo-retry"
                accessibilityRole="button"
                accessibilityLabel="Повторить отправку фото"
                onPress={onRetry}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: tokens.primary }]}>Повторить</Text>
              </Pressable>
              <Pressable
                testID="native-scan-photo-discard"
                accessibilityRole="button"
                accessibilityLabel="Отбросить неотправленные фото"
                onPress={onDiscardFailed}
                hitSlop={8}
              >
                <Text style={[styles.link, { color: tokens.textSecondary }]}>Отбросить</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <Pressable
          testID="native-scan-photo-shutter"
          accessibilityRole="button"
          accessibilityLabel="Сделать фото"
          accessibilityState={{ disabled: !hasTarget || capturing }}
          disabled={!hasTarget || capturing}
          onPress={onCapture}
          style={({ pressed }) => [
            styles.shutter,
            { opacity: !hasTarget ? 0.4 : pressed ? 0.8 : 1, borderColor: tokens.panelSolid },
          ]}
        >
          <MaterialCommunityIcons name="camera" size={30} color="#fff" />
        </Pressable>
      </View>
      {onTogglePreview ? (
        <Pressable
          testID="native-scan-photo-preview-toggle"
          accessibilityRole="switch"
          accessibilityLabel="Показывать кадр перед отправкой"
          accessibilityState={{ checked: previewEnabled }}
          onPress={onTogglePreview}
          hitSlop={8}
        >
          <Text style={[styles.link, { color: tokens.textSecondary }]}>
            {previewEnabled ? 'Кадр перед отправкой: показывать' : 'Кадр перед отправкой: сразу отправлять'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { marginHorizontal: 12, marginBottom: 12, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '900' },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  exit: { minHeight: 40, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  exitText: { fontSize: 13, fontWeight: '800' },
  body: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  counters: { flex: 1, gap: 4 },
  counter: { fontSize: 17, fontWeight: '900' },
  counterSmall: { fontSize: 12, fontWeight: '700' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  failedRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  link: { fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  previewFrame: { height: 180, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  previewImage: { width: '100%', height: '100%' },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewSpacer: { flex: 1 },
  roundButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  accept: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: SHUTTER_GREEN },
  acceptText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  shutter: {
    width: 68, height: 68, borderRadius: 34, borderWidth: 3,
    backgroundColor: SHUTTER_GREEN, alignItems: 'center', justifyContent: 'center',
  },
});
