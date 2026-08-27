import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, Text, View } from 'react-native';
import type { Warehouse1CCatalogItem, Warehouse1CCatalogKind } from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';

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
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.panelInset }]}>
        <MaterialCommunityIcons
          name={isWarehouse ? 'warehouse' : 'package-variant-closed'}
          size={24}
          color={tokens.primary}
        />
      </View>
      <View style={styles.content}>
        <Text numberOfLines={3} style={[styles.title, { color: tokens.textPrimary }]}>{item.name}</Text>
        {codeLabel ? <Text numberOfLines={1} style={[styles.code, { color: tokens.textSecondary }]}>{codeLabel}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 82,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  code: { marginTop: 3, fontSize: 11, lineHeight: 16, fontWeight: '700' },
});
