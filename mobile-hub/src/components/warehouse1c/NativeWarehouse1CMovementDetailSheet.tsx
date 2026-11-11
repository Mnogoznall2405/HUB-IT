import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import type {
  Warehouse1CMovement,
  Warehouse1CMovementDetail,
  Warehouse1CMovementFile,
} from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal } from '../ui/NativeModal';
import { NativeSheetHeader } from '../ui/NativeFilterControls';
import { formatWarehouse1cDate } from './NativeWarehouse1CCards';

function formatFileSize(bytes: number): string {
  const size = Math.max(0, Number(bytes || 0));
  if (!size) return '';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

export function NativeWarehouse1CMovementDetailSheet({
  visible,
  movement,
  detail,
  loading,
  error,
  busyFileKey,
  onClose,
  onDownloadFile,
  onPreviewFile,
  tokens,
}: {
  visible: boolean;
  movement: Warehouse1CMovement | null;
  detail: Warehouse1CMovementDetail | null;
  loading: boolean;
  error: string;
  busyFileKey: string;
  onClose: () => void;
  onDownloadFile: (registrarRef: string, file: Warehouse1CMovementFile) => void;
  onPreviewFile: (registrarRef: string, file: Warehouse1CMovementFile) => void;
  tokens: FluentTokens;
}) {
  const fromName = detail?.transferFromWarehouseName || movement?.transferFromWarehouseName || '';
  const toName = detail?.transferToWarehouseName || movement?.transferToWarehouseName || '';
  const warehouseName = detail?.warehouseName || movement?.warehouseName || '';
  const registrarNumber = detail?.registrarNumber || movement?.registrarNumber || '';
  const registrarDate = detail?.registrarDate || movement?.registrarDate || '';
  const registrarName = detail?.registrarName || movement?.registrarName || '';
  const registrarRef = detail?.registrarRef || movement?.registrarRef || '';
  const isTransfer = detail ? detail.isTransfer : Boolean(movement?.isTransfer);
  const title = detail?.documentTitle || (isTransfer ? 'Перемещение между складами' : 'Документ склада');
  const files = detail?.files || [];
  const filesStatus = detail?.filesStatus || 'pending';
  const hasRoute = Boolean(fromName || toName);
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;

  return (
    <NativeModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть документ"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, {
            backgroundColor: tokens.panelSolid,
            borderColor: tokens.borderSoft,
            paddingBottom: Math.max(16, (insets?.bottom || 0) + 8),
            paddingLeft: insets?.left || 0,
            paddingRight: insets?.right || 0,
          }]}
        >
        <NativeSheetHeader title={title} tokens={tokens} onClose={onClose} />
        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.section, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Документ</Text>
            <Text style={[styles.value, { color: tokens.textPrimary }]}>
              {registrarNumber ? `№ ${registrarNumber}` : registrarName || '—'}
            </Text>
            {registrarDate ? (
              <Text style={[styles.meta, { color: tokens.textSecondary }]}>{formatWarehouse1cDate(registrarDate)}</Text>
            ) : null}
          </View>

          <View style={[styles.section, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
            {hasRoute ? (
              <>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Маршрут перемещения</Text>
                <View style={styles.routeRow}>
                  <Text numberOfLines={2} style={[styles.routeText, { color: tokens.textPrimary }]}>{fromName || 'Не указан'}</Text>
                  <MaterialCommunityIcons name="arrow-right" size={17} color={tokens.primary} />
                  <Text numberOfLines={2} style={[styles.routeText, { color: tokens.primary }]}>{toName || 'Не указан'}</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Склад</Text>
                <Text style={[styles.value, { color: tokens.textPrimary }]}>{warehouseName || 'Не указан'}</Text>
                {detail?.counterpartyName ? (
                  <Text style={[styles.meta, { color: tokens.textSecondary }]}>Контрагент: {detail.counterpartyName}</Text>
                ) : null}
              </>
            )}
          </View>

          {detail?.comment ? (
            <View style={[styles.section, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
              <Text style={[styles.label, { color: tokens.textSecondary }]}>Комментарий</Text>
              <Text style={[styles.meta, { color: tokens.textPrimary }]}>{detail.comment}</Text>
            </View>
          ) : null}

          <View style={[styles.section, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Прикреплённые файлы</Text>
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={tokens.primary} />
                <Text style={[styles.meta, { color: tokens.textSecondary }]}>Загрузка списка файлов…</Text>
              </View>
            ) : null}
            {error ? <Text accessibilityRole="alert" style={[styles.meta, { color: tokens.error }]}>{error}</Text> : null}
            {!loading && !error && filesStatus === 'access_denied' ? (
              <Text style={[styles.meta, { color: tokens.warning }]}>
                {detail?.filesMessage || 'Нет прав на чтение прикреплённых файлов в 1С.'}
              </Text>
            ) : null}
            {!loading && !error && (filesStatus === 'unsupported' || filesStatus === 'empty') && files.length === 0 ? (
              <Text style={[styles.meta, { color: tokens.textSecondary }]}>
                {detail?.filesMessage || 'Прикреплённые файлы недоступны.'}
              </Text>
            ) : null}
            {!loading && !error && filesStatus === 'ok' && files.length === 0 ? (
              <Text style={[styles.meta, { color: tokens.textSecondary }]}>К этому документу файлы не прикреплены.</Text>
            ) : null}
            {files.map((file) => {
              const fileKey = file.ref || file.name;
              const busy = busyFileKey === fileKey;
              return (
                <View key={fileKey} style={[styles.fileRow, { borderColor: tokens.borderSoft }]}>
                  <MaterialCommunityIcons name="paperclip" size={18} color={tokens.iconMuted} />
                  <View style={styles.fileBody}>
                    <Text numberOfLines={2} style={[styles.fileName, { color: tokens.textPrimary }]}>{file.name}</Text>
                    {formatFileSize(file.size) ? <Text style={[styles.meta, { color: tokens.textTertiary }]}>{formatFileSize(file.size)}</Text> : null}
                  </View>
                  {busy ? <ActivityIndicator size="small" color={tokens.primary} /> : (
                    <View style={styles.fileActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Открыть ${file.name}`}
                        disabled={!file.ref || !registrarRef}
                        onPress={() => onPreviewFile(registrarRef, file)}
                        style={({ pressed }) => [styles.fileAction, pressed && styles.pressed]}
                      >
                        <MaterialCommunityIcons name="eye-outline" size={20} color={tokens.primary} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Скачать ${file.name}`}
                        disabled={!file.ref || !registrarRef}
                        onPress={() => onDownloadFile(registrarRef, file)}
                        style={({ pressed }) => [styles.fileAction, pressed && styles.pressed]}
                      >
                        <MaterialCommunityIcons name="download-outline" size={20} color={tokens.primary} />
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
        </View>
      </View>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: {
    maxHeight: '92%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },
  section: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 4 },
  label: { fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  meta: { fontSize: 12, lineHeight: 17 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileRow: {
    borderTopWidth: 1,
    paddingTop: 9,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  fileBody: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  fileActions: { flexDirection: 'row', alignItems: 'center' },
  fileAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
