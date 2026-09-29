import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  Warehouse1CBalance,
  Warehouse1CCatalogItem,
  Warehouse1CCatalogKind,
  Warehouse1CDismissedWarehouse,
  Warehouse1CMovement,
} from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';

export function formatWarehouse1cNumber(value: number, digits = 3): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return numeric.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

export function formatWarehouse1cDate(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleDateString('ru-RU');
}

function docRequisite(number: string, date: string): string {
  const safeNumber = String(number || '').trim();
  const safeDate = formatWarehouse1cDate(date);
  if (!safeNumber && !safeDate) return '';
  return `${safeNumber || '—'}${safeDate ? ` от ${safeDate}` : ''}`;
}

export function NativeWarehouse1CCatalogCard({
  item,
  kind,
  tokens,
}: {
  item: Warehouse1CCatalogItem;
  kind: Warehouse1CCatalogKind;
  tokens: FluentTokens;
}) {
  const isWarehouse = kind === 'warehouses';
  const codeLabel = item.code ? `Код ${item.code}` : '';
  return (
    <View
      accessible
      accessibilityLabel={[item.name, codeLabel].filter(Boolean).join('. ')}
      style={[styles.row, styles.rowWithIcon, { borderBottomColor: tokens.borderSoft }]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.panelInset }]}>
        <MaterialCommunityIcons
          name={isWarehouse ? 'warehouse' : 'package-variant-closed'}
          size={20}
          color={tokens.primary}
        />
      </View>
      <View style={styles.content}>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{item.name}</Text>
        {codeLabel ? <Text numberOfLines={1} style={[styles.code, { color: tokens.textSecondary }]}>{codeLabel}</Text> : null}
      </View>
    </View>
  );
}

export function NativeWarehouse1CBalanceCard({
  item,
  tokens,
  onMovements,
}: {
  item: Warehouse1CBalance;
  tokens: FluentTokens;
  onMovements?: (item: Warehouse1CBalance) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const seriesLabel = item.seriesName || item.seriesNumber;
  const badges = [item.batchStatusName, item.costMethodName].filter(Boolean).join(' · ');
  const torg12 = docRequisite(item.torg12Number, item.torg12Date);
  const invoice = docRequisite(item.invoiceNumber, item.invoiceDate);
  const docs = [torg12 && `ТОРГ-12: ${torg12}`, invoice && `СФ: ${invoice}`].filter(Boolean).join(' · ');
  const headLine = [
    item.nomenclatureCode,
    item.warehouseName || 'Склад не указан',
    formatWarehouse1cNumber(item.costBalance),
  ].filter(Boolean).join(' · ');
  return (
    <View style={[styles.row, { borderBottomColor: tokens.borderSoft }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${item.nomenclatureName || 'Номенклатура'}. Остаток ${formatWarehouse1cNumber(item.qtyBalance)}. ${item.warehouseName || 'Склад не указан'}. ${expanded ? 'Свернуть детали' : 'Показать детали'}`}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.balanceHead, pressed && { backgroundColor: tokens.panelInset }]}
      >
        <View style={styles.content}>
          <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{item.nomenclatureName || 'Без названия'}</Text>
          <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>{headLine}</Text>
        </View>
        <View style={styles.qtyBlock}>
          <Text style={[styles.qty, { color: tokens.primary }]}>{formatWarehouse1cNumber(item.qtyBalance)}</Text>
          <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={19} color={tokens.iconMuted} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.balanceDetails}>
          {item.characteristicName ? <Text numberOfLines={2} style={[styles.meta, { color: tokens.textSecondary }]}>Характеристика: {item.characteristicName}</Text> : null}
          {seriesLabel ? <Text numberOfLines={2} style={[styles.meta, { color: tokens.textSecondary }]}>Серия: {seriesLabel}</Text> : null}
          <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>Бух: {formatWarehouse1cNumber(item.costAccountingBalance)} · Ср. цена: {formatWarehouse1cNumber(item.avgPrice)}</Text>
          {badges ? <Text numberOfLines={2} style={[styles.meta, { color: tokens.textTertiary }]}>{badges}</Text> : null}
          {docs ? <Text numberOfLines={2} style={[styles.meta, { color: tokens.textTertiary }]}>{docs}</Text> : null}
          {onMovements && item.nomenclatureRef ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Движения по ${item.nomenclatureName}`}
              onPress={() => onMovements(item)}
              style={({ pressed }) => [styles.linkRow, styles.linkRowCompact, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="swap-horizontal" size={18} color={tokens.primary} />
              <Text style={[styles.linkText, { color: tokens.primary }]}>Движения по позиции</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function NativeWarehouse1CMovementCard({
  item,
  tokens,
  onPress,
}: {
  item: Warehouse1CMovement;
  tokens: FluentTokens;
  onPress?: (item: Warehouse1CMovement) => void;
}) {
  const hasRoute = Boolean(item.transferFromWarehouseName || item.transferToWarehouseName);
  const dateLabel = formatWarehouse1cDate(item.period || item.registrarDate);
  const body = (
    <View style={styles.content}>
      <View style={styles.movementTitleRow}>
        <Text numberOfLines={1} style={[styles.title, styles.movementTitle, { color: tokens.textPrimary }]}>
          {item.registrarNumber ? `№ ${item.registrarNumber} · ${item.registrarName || 'Документ'}` : item.registrarName || 'Документ склада'}
        </Text>
        {dateLabel ? <Text style={[styles.movementDate, { color: tokens.textSecondary }]}>{dateLabel}</Text> : null}
      </View>
      {hasRoute ? (
        <View style={styles.routeRow}>
          <Text numberOfLines={1} style={[styles.routeText, { color: tokens.textSecondary }]}>{item.transferFromWarehouseName || '—'}</Text>
          <MaterialCommunityIcons name="arrow-right" size={14} color={tokens.iconMuted} />
          <Text numberOfLines={1} style={[styles.routeText, { color: tokens.textSecondary }]}>{item.transferToWarehouseName || '—'}</Text>
        </View>
      ) : item.warehouseName ? (
        <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>{item.warehouseName}</Text>
      ) : null}
      <Text numberOfLines={1} style={[styles.movementQty, { color: tokens.textSecondary }]}>
        +{formatWarehouse1cNumber(item.qtyIn)} · −{formatWarehouse1cNumber(item.qtyOut)} · <Text style={{ color: tokens.primary, fontWeight: '800' }}>{formatWarehouse1cNumber(item.qtyStart)} → {formatWarehouse1cNumber(item.qtyEnd)}</Text>
      </Text>
    </View>
  );
  if (!onPress || !item.canOpenDetail) {
    return <View style={[styles.row, { borderBottomColor: tokens.borderSoft }]}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Открыть документ ${item.registrarNumber ? `№ ${item.registrarNumber}` : item.registrarName}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.row,
        styles.rowPressable,
        { borderBottomColor: tokens.borderSoft },
        pressed && { backgroundColor: tokens.panelInset },
      ]}
    >
      {body}
      <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
    </Pressable>
  );
}

export function NativeWarehouse1CDismissedCard({
  item,
  expanded,
  onToggle,
  tokens,
}: {
  item: Warehouse1CDismissedWarehouse;
  expanded: boolean;
  onToggle: () => void;
  tokens: FluentTokens;
}) {
  const candidateNames = item.employeeCandidates.map((candidate) => candidate.employeeName).filter(Boolean);
  const employeeLabel = item.employeeName || candidateNames[0] || '';
  return (
    <View style={[styles.row, { borderBottomColor: tokens.borderSoft }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Свернуть' : 'Развернуть'} склад ${item.warehouseName}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.dismissedHead, pressed && { backgroundColor: tokens.panelInset }]}
      >
        <View style={styles.content}>
          <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{item.warehouseName}</Text>
          {employeeLabel ? <Text numberOfLines={1} style={[styles.metaStrong, { color: tokens.textSecondary }]}>Уволенный: {employeeLabel}</Text> : null}
          {candidateNames.length > 1 ? <Text numberOfLines={2} style={[styles.meta, { color: tokens.warning }]}>Возможные совпадения: {candidateNames.join(', ')}</Text> : null}
          <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>
            {[item.city, `${item.positions} поз. · ${formatWarehouse1cNumber(item.totalQty)} ед. · ${formatWarehouse1cNumber(item.totalCost)}`].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={tokens.iconMuted} />
      </Pressable>
      {expanded ? (
        <View style={[styles.dismissedBalances, { borderTopColor: tokens.borderSoft }]}>
          {item.balances.length === 0 ? (
            <Text style={[styles.meta, { color: tokens.textSecondary }]}>Остатки не загружены.</Text>
          ) : item.balances.map((balance, index) => (
            <View key={`${balance.nomenclatureRef || balance.nomenclatureCode || index}`} style={styles.dismissedBalanceRow}>
              <Text numberOfLines={2} style={[styles.metaStrong, { color: tokens.textPrimary }]}>
                {balance.nomenclatureCode ? `${balance.nomenclatureCode} · ` : ''}{balance.nomenclatureName}
              </Text>
              <Text style={[styles.meta, { color: tokens.textSecondary }]}>
                {formatWarehouse1cNumber(balance.qtyBalance)} ед. · {formatWarehouse1cNumber(balance.costBalance)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 2,
  },
  rowWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  rowPressable: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  balanceHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  qtyBlock: { alignItems: 'flex-end', gap: 0 },
  balanceDetails: { paddingBottom: 9, paddingTop: 2, paddingLeft: 2, gap: 3 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  code: { marginTop: 3, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  meta: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  metaStrong: { marginTop: 3, fontSize: 12, lineHeight: 17, fontWeight: '700', flexShrink: 1 },
  rowBetween: { marginTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  qty: { fontSize: 16, lineHeight: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  routeRow: { marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 6 },
  routeText: { flexShrink: 1, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  movementTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  movementTitle: { flex: 1, minWidth: 0 },
  movementDate: { fontSize: 11, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  movementQty: { marginTop: 3, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  linkRow: { marginTop: 7, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkRowCompact: { marginTop: 4, minHeight: 36 },
  linkText: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  dismissedHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  dismissedBalances: { width: '100%', paddingTop: 8, paddingBottom: 9, borderTopWidth: StyleSheet.hairlineWidth, gap: 7 },
  dismissedBalanceRow: { gap: 2 },
});
