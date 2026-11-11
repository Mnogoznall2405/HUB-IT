import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import type { FluentTokens } from '../../theme/fluentTokens';
import { AccountSectionCard } from '../../screens/account/AccountChrome';
import { copyIconHitSlop, copyNativeFieldValue } from './NativeCopyableField';

export type NativeEquipmentSectionItem = {
  key: string;
  empty: boolean;
  node: ReactNode;
};

export function NativeEquipmentSection({
  tokens,
  title,
  sectionKey,
  items,
  alwaysShow = false,
}: {
  tokens: FluentTokens;
  title: string;
  sectionKey: string;
  items: NativeEquipmentSectionItem[];
  alwaysShow?: boolean;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const emptyCount = items.reduce((total, item) => total + (item.empty ? 1 : 0), 0);
  if (!alwaysShow && emptyCount === items.length) return null;
  return (
    <AccountSectionCard tokens={tokens} title={title}>
      {items.map((item) => (item.empty && !showEmpty ? null : <Fragment key={item.key}>{item.node}</Fragment>))}
      {emptyCount ? (
        <Pressable
          testID={`native-equipment-section-${sectionKey}-empty-toggle`}
          accessibilityRole="button"
          accessibilityLabel={showEmpty ? 'Скрыть пустые поля' : `Показать пустые поля: ${emptyCount}`}
          onPress={() => setShowEmpty((current) => !current)}
          style={styles.emptyToggle}
        >
          <Text style={[styles.emptyToggleText, { color: tokens.primary }]}>{showEmpty ? 'Скрыть пустые' : `Показать пустые (${emptyCount})`}</Text>
          <MaterialCommunityIcons name={showEmpty ? 'chevron-up' : 'chevron-down'} size={18} color={tokens.primary} />
        </Pressable>
      ) : null}
    </AccountSectionCard>
  );
}

export function NativeEquipmentDescriptionField({
  tokens,
  value,
  testID,
}: {
  tokens: FluentTokens;
  value?: string | null;
  testID: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const display = String(value ?? '').trim();
  useEffect(() => {
    setExpanded(false);
    setTotalLines(null);
  }, [display]);
  const copy = () => { void copyNativeFieldValue(display, 'Описание скопировано'); };
  const collapsible = totalLines !== null && totalLines > 4;

  if (!display) {
    return (
      <View testID={testID} accessible accessibilityLabel="Описание: не указано" style={[styles.row, { borderBottomColor: tokens.borderSoft }]}>
        <Text style={[styles.label, { color: tokens.textSecondary }]}>Описание</Text>
        <Text style={[styles.value, { color: tokens.textPrimary }]}>—</Text>
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onLongPress={copy}
      accessibilityLabel={`Описание: ${display}`}
      accessibilityHint="Долгое нажатие — скопировать"
      accessibilityActions={[{ name: 'copy', label: 'Скопировать' }]}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'copy') copy(); }}
      style={({ pressed }) => [styles.row, { borderBottomColor: tokens.borderSoft }, pressed ? styles.rowPressed : null]}
    >
      <Text style={[styles.label, { color: tokens.textSecondary }]}>Описание</Text>
      <View>
        <Text
          selectable
          numberOfLines={expanded ? undefined : 4}
          style={[styles.value, { color: tokens.textPrimary }]}
        >
          {display}
        </Text>
        {totalLines === null ? (
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onTextLayout={(event) => setTotalLines(event.nativeEvent.lines.length)}
            style={[styles.value, { color: tokens.textPrimary }, styles.measureCopy]}
          >
            {display}
          </Text>
        ) : null}
      </View>
      <View style={styles.actionsRow}>
        {collapsible ? (
          <Pressable
            testID={`${testID}-more`}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Свернуть описание' : 'Показать описание целиком'}
            onPress={(event: GestureResponderEvent) => { event.stopPropagation(); setExpanded((current) => !current); }}
            style={styles.moreButton}
          >
            <Text style={[styles.moreText, { color: tokens.primary }]}>{expanded ? 'Свернуть' : 'Ещё'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID={`${testID}-copy`}
          accessibilityRole="button"
          accessibilityLabel="Скопировать: Описание"
          onPress={copy}
          onLongPress={copy}
          hitSlop={copyIconHitSlop}
          style={styles.copyButton}
        >
          <MaterialCommunityIcons name="content-copy" size={18} color={tokens.iconMuted} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  emptyToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  emptyToggleText: { fontSize: 13, fontWeight: '800' },
  row: { minHeight: 48, paddingVertical: 8, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { opacity: 0.72 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  value: { fontSize: 14, lineHeight: 19, fontWeight: '600', textAlign: 'left' },
  measureCopy: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moreButton: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  moreText: { fontSize: 13, fontWeight: '800' },
  copyButton: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
});
