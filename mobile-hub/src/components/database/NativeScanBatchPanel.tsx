import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { equipmentLocation, equipmentOwner, equipmentTitle } from '../../database/nativeDatabaseModel';
import type { ScanBatchItem } from '../../database/useNativeScanBatch';
import type { FluentTokens } from '../../theme/fluentTokens';

function itemStatusLabel(item: ScanBatchItem): string {
  if (item.status === 'missing') return 'Не найдено';
  if (item.status === 'offline-missing') return 'Нет данных офлайн';
  return '';
}

function ScanBatchRow({
  item,
  tokens,
  highlighted,
  onRemove,
}: {
  item: ScanBatchItem;
  tokens: FluentTokens;
  highlighted: boolean;
  onRemove: (invNo: string) => void;
}) {
  const missingLabel = itemStatusLabel(item);
  return (
    <View
      testID={`native-scan-batch-row-${item.invNo}`}
      style={[styles.row, { borderColor: tokens.borderSoft, backgroundColor: highlighted ? tokens.panelInset : 'transparent' }]}
    >
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.textPrimary }]}>
          {item.equipment ? equipmentTitle(item.equipment) : `Инв. № ${item.invNo}`}
        </Text>
        <Text numberOfLines={1} style={[styles.rowMeta, { color: tokens.textSecondary }]}>
          {item.equipment ? `Инв. № ${item.invNo}` : missingLabel}
        </Text>
        {item.equipment ? (
          <Text numberOfLines={1} style={[styles.rowMeta, { color: tokens.textSecondary }]}>
            {equipmentOwner(item.equipment)}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID={`native-scan-batch-remove-${item.invNo}`}
        accessibilityRole="button"
        accessibilityLabel={`Убрать ${item.invNo} из списка`}
        hitSlop={8}
        onPress={() => onRemove(item.invNo)}
        style={styles.remove}
      >
        <MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} />
      </Pressable>
    </View>
  );
}

export function NativeScanBatchPanel({
  tokens,
  items,
  expanded,
  highlightInvNo,
  offline,
  onToggleExpanded,
  onOpen,
  onCollapse,
  onRemove,
  onActions,
}: {
  tokens: FluentTokens;
  items: ScanBatchItem[];
  expanded: boolean;
  highlightInvNo?: string;
  offline: boolean;
  onToggleExpanded: () => void;
  onOpen: (item: ScanBatchItem) => void;
  onCollapse: () => void;
  onRemove: (invNo: string) => void;
  onActions: () => void;
}) {
  if (!items.length) return null;
  const readyCount = items.filter((item) => item.status === 'ready' && item.equipment).length;

  if (!expanded) {
    return (
      <View pointerEvents="box-none" style={styles.dock}>
        <Pressable
          testID="native-scan-batch-strip"
          accessibilityRole="button"
          accessibilityLabel={`Выбрано: ${items.length}. Развернуть список`}
          accessibilityLiveRegion="polite"
          onPress={onToggleExpanded}
          style={[styles.strip, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
        >
          <MaterialCommunityIcons name="qrcode-scan" size={17} color={tokens.primary} />
          <Text style={[styles.stripText, { color: tokens.textPrimary }]}>Выбрано: {items.length}</Text>
          <MaterialCommunityIcons name="chevron-up" size={19} color={tokens.iconMuted} />
        </Pressable>
      </View>
    );
  }

  if (items.length === 1) {
    const item = items[0];
    const missingLabel = itemStatusLabel(item);
    return (
      <View pointerEvents="box-none" style={styles.dock}>
        <View testID="native-scan-batch-card" style={[styles.panel, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
          <Text numberOfLines={2} style={[styles.cardTitle, { color: tokens.textPrimary }]}>
            {item.equipment ? equipmentTitle(item.equipment) : `Инв. № ${item.invNo}`}
          </Text>
          {item.equipment ? (
            <Text numberOfLines={1} style={[styles.cardMeta, { color: tokens.textSecondary }]}>
              {`Инв. № ${item.invNo}`}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={[styles.cardMeta, { color: missingLabel ? tokens.error : tokens.textSecondary }]}>
            {missingLabel || equipmentOwner(item.equipment!)}
          </Text>
          {item.equipment ? (
            <Text numberOfLines={1} style={[styles.cardMeta, { color: tokens.textSecondary }]}>
              {equipmentLocation(item.equipment)}
            </Text>
          ) : null}
          <View style={styles.cardActions}>
            <Pressable
              testID="native-scan-batch-open"
              accessibilityRole="button"
              accessibilityLabel={`Открыть карточку ${item.invNo}`}
              onPress={() => onOpen(item)}
              style={[styles.cardButton, { backgroundColor: tokens.primary }]}
            >
              <Text style={styles.cardButtonText}>Открыть</Text>
            </Pressable>
            <Pressable
              testID="native-scan-batch-more"
              accessibilityRole="button"
              accessibilityLabel="Продолжить сканирование следующего QR"
              onPress={onCollapse}
              style={[styles.cardButton, styles.cardButtonGhost, { borderColor: tokens.border }]}
            >
              <Text style={[styles.cardButtonText, { color: tokens.textPrimary }]}>+ Ещё QR</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.dock}>
      <View testID="native-scan-batch-list" style={[styles.panel, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
        <View style={styles.header}>
          <Pressable
            testID="native-scan-batch-collapse"
            accessibilityRole="button"
            accessibilityLabel="Свернуть список"
            onPress={onToggleExpanded}
            style={styles.collapse}
          >
            <Text accessibilityLiveRegion="polite" style={[styles.headerTitle, { color: tokens.textPrimary }]}>
              Выбрано: {items.length}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={19} color={tokens.iconMuted} />
          </Pressable>
          <Pressable
            testID="native-scan-batch-actions"
            accessibilityRole="button"
            accessibilityLabel={`Действия для ${readyCount} позиций`}
            accessibilityState={{ disabled: offline || !readyCount }}
            onPress={onActions}
            disabled={offline || !readyCount}
            style={[styles.actionsButton, { backgroundColor: offline || !readyCount ? tokens.panelInset : tokens.primary }]}
          >
            <Text style={[styles.cardButtonText, offline || !readyCount ? { color: tokens.textSecondary } : null]}>
              Действия ({readyCount})
            </Text>
          </Pressable>
        </View>
        {offline ? (
          <Text style={[styles.offlineHint, { color: tokens.textSecondary }]}>Нужна сеть</Text>
        ) : null}
        <ScrollView style={styles.rows} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {items.map((item) => (
            <ScanBatchRow
              key={item.invNo}
              item={item}
              tokens={tokens}
              highlighted={highlightInvNo === item.invNo}
              onRemove={onRemove}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 14, right: 14, bottom: 18 },
  panel: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 11 },
  strip: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  stripText: { fontSize: 13, fontWeight: '900' },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: '900' },
  cardMeta: { marginTop: 3, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  cardActions: { marginTop: 11, flexDirection: 'row', gap: 8 },
  cardButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardButtonGhost: { borderWidth: 1 },
  cardButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapse: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { fontSize: 14, fontWeight: '900' },
  actionsButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  offlineHint: { fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 1, marginBottom: 2, textAlign: 'right' },
  rows: { maxHeight: 188 },
  row: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', borderRadius: 6, paddingLeft: 4 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  rowMeta: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
