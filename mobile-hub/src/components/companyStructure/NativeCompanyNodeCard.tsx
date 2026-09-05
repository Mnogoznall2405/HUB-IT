import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompanyStructureNode } from '../../api/companyStructureApi';
import {
  companyNodeTitle,
  companyNodeTypeLabel,
  companyPersonInitials,
} from '../../companyStructure/nativeCompanyStructureModel';
import type { FluentTokens } from '../../theme/fluentTokens';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';
import { AuthenticatedRemoteImage } from '../ui/AuthenticatedRemoteImage';

export const NativeCompanyNodeCard = memo(function NativeCompanyNodeCard({
  node,
  tokens,
  selected = false,
  onSelect,
  onPeople,
}: {
  node: CompanyStructureNode;
  tokens: FluentTokens;
  selected?: boolean;
  onSelect?: (nodeId: string) => void;
  onPeople: (nodeId: string) => void;
}) {
  const title = companyNodeTitle(node);
  const leader = ['root', 'deputy'].includes(node.node_type)
    && Boolean(node.person_name || node.person_position || node.person_employee_code);
  const photoUrl = leader ? resolveAttachmentUrl(node.person_photo_url) : null;
  return (
    <View
      testID={`native-company-node-${node.id}`}
      style={[
        styles.card,
        {
          backgroundColor: selected ? tokens.selected : tokens.panelSolid,
          borderColor: selected ? tokens.primary : tokens.borderSoft,
        },
      ]}
    >
      <Pressable
        onPress={() => onSelect?.(node.id)}
        disabled={!onSelect}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${companyNodeTypeLabel(node)}`}
        accessibilityState={{ disabled: !onSelect, selected }}
        style={({ pressed }) => [styles.body, { opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.avatar, { backgroundColor: tokens.accentSoft }]}>
          {photoUrl ? (
            <AuthenticatedRemoteImage
              uri={photoUrl}
              style={{ width: 48, height: 48 }}
              accessibilityLabel={`Фото ${node.person_name || title}`}
              fallback={<Text style={[styles.initials, { color: tokens.primary }]}>{companyPersonInitials(node.person_name || title)}</Text>}
            />
          ) : leader ? (
            <Text style={[styles.initials, { color: tokens.primary }]}>{companyPersonInitials(node.person_name || title)}</Text>
          ) : (
            <MaterialCommunityIcons name="office-building-outline" size={24} color={tokens.primary} />
          )}
        </View>
        <View style={styles.textBody}>
          <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
          {leader && node.person_name ? <Text numberOfLines={1} style={[styles.person, { color: tokens.textSecondary }]}>{node.person_name}</Text> : null}
          {leader && node.person_position && node.person_position !== title ? <Text numberOfLines={1} style={[styles.meta, { color: tokens.textTertiary }]}>{node.person_position}</Text> : null}
          <Text style={[styles.type, { color: tokens.textTertiary }]}>{companyNodeTypeLabel(node)}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={21} color={tokens.iconMuted} />
      </Pressable>
      <View style={[styles.footer, { borderTopColor: tokens.borderSoft }]}>
        <Text style={[styles.count, { color: tokens.textTertiary }]}>Подразделений: {node.child_node_count || node.children.length}</Text>
        <Pressable
          testID={`native-company-node-people-${node.id}`}
          onPress={() => onPeople(node.id)}
          accessibilityRole="button"
          accessibilityLabel={`Сотрудники подразделения ${title}: ${node.subtree_people_count}`}
          style={styles.peopleAction}
        >
          <MaterialCommunityIcons name="account-group-outline" size={18} color={tokens.primary} />
          <Text style={[styles.peopleText, { color: tokens.primary }]}>Сотрудники · {node.subtree_people_count}</Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 9 },
  body: { minHeight: 102, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { fontSize: 15, fontWeight: '900' },
  textBody: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, lineHeight: 19, fontWeight: '800' },
  person: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  meta: { fontSize: 11, lineHeight: 15 },
  type: { marginTop: 2, fontSize: 11, lineHeight: 15 },
  footer: { minHeight: 46, borderTopWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { fontSize: 11 },
  peopleAction: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  peopleText: { fontSize: 12, fontWeight: '800' },
});
