import { NativeModal as Modal } from '../ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CompanyStructureNode } from '../../api/companyStructureApi';
import {
  companyNodeTitle,
  companyNodeTypeLabel,
  flattenCompanyStructure,
} from '../../companyStructure/nativeCompanyStructureModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeCompanyHierarchySheet = memo(function NativeCompanyHierarchySheet({
  visible,
  tree,
  selectedId,
  tokens,
  onClose,
  onSelect,
}: {
  visible: boolean;
  tree: CompanyStructureNode[];
  selectedId: string;
  tokens: FluentTokens;
  onClose: () => void;
  onSelect: (nodeId: string) => void;
}) {
  const rows = useMemo(() => flattenCompanyStructure(tree), [tree]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView accessibilityViewIsModal style={[styles.safe, { backgroundColor: tokens.pageBg }]}>
        <View style={[styles.header, { backgroundColor: tokens.headerBandBg, borderBottomColor: tokens.borderSoft }]}>
          <View style={styles.titleBody}>
            <Text style={[styles.title, { color: tokens.textPrimary }]}>Вся структура</Text>
            <Text style={[styles.subtitle, { color: tokens.textSecondary }]}>
              {rows.length} {rows.length === 1 ? 'узел' : 'узлов'} · иерархический вид
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Закрыть всю структуру"
            style={styles.close}
          >
            <MaterialCommunityIcons name="close" size={24} color={tokens.textPrimary} />
          </Pressable>
        </View>

        <FlatList
          testID="native-company-hierarchy-list"
          data={rows}
          keyExtractor={({ node }) => node.id}
          contentContainerStyle={rows.length ? styles.list : styles.empty}
          ListEmptyComponent={(
            <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Структура пока пуста.</Text>
          )}
          renderItem={({ item: { node, depth } }) => {
            const selected = node.id === selectedId;
            const title = companyNodeTitle(node);
            return (
              <Pressable
                onPress={() => onSelect(node.id)}
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${companyNodeTypeLabel(node)}, уровень ${depth + 1}`}
                accessibilityState={{ selected }}
                style={[
                  styles.row,
                  {
                    marginLeft: Math.min(depth, 6) * 18,
                    backgroundColor: selected ? tokens.selected : tokens.panelSolid,
                    borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                  },
                ]}
              >
                <View style={[styles.depthMarker, { backgroundColor: selected ? tokens.primary : tokens.borderStrong }]} />
                <View style={styles.rowBody}>
                  <Text numberOfLines={2} style={[styles.rowTitle, { color: tokens.textPrimary }]}>{title}</Text>
                  <Text numberOfLines={1} style={[styles.rowMeta, { color: tokens.textSecondary }]}>
                    {companyNodeTypeLabel(node)} · {node.subtree_people_count} сотрудников
                  </Text>
                </View>
                {node.children.length ? (
                  <View style={[styles.countBadge, { backgroundColor: tokens.accentSoft }]}>
                    <Text style={[styles.countText, { color: tokens.primary }]}>{node.children.length}</Text>
                  </View>
                ) : null}
                <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 58, borderBottomWidth: 1, paddingLeft: 16, paddingRight: 4, flexDirection: 'row', alignItems: 'center' },
  titleBody: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 24 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { textAlign: 'center', fontSize: 13 },
  row: { minHeight: 58, marginBottom: 8, borderWidth: 1, borderRadius: 14, paddingRight: 8, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  depthMarker: { alignSelf: 'stretch', width: 3, marginRight: 11 },
  rowBody: { flex: 1, minWidth: 0, paddingVertical: 9 },
  rowTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  rowMeta: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  countBadge: { minWidth: 26, height: 26, marginLeft: 8, borderRadius: 13, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 11, fontWeight: '900' },
});
