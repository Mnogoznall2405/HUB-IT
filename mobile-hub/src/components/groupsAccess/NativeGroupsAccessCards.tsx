import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, Text, View } from 'react-native';
import type { GroupsAccessGroup } from '../../api/groupsAccessApi';
import type { useFluentTokens } from '../../theme/fluentTokens';

type Tokens = ReturnType<typeof useFluentTokens>;

export function accessLevelLabel(level: string): string {
  switch (String(level || '').toLowerCase()) {
    case 'read': return 'Чтение';
    case 'write': return 'Запись';
    case 'full': return 'Полный доступ';
    default: return 'Доступ';
  }
}

function AccessBadge({ level, tokens }: { level: string; tokens: Tokens }) {
  return (
    <View style={[styles.badge, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
      <Text style={[styles.badgeText, { color: tokens.primary }]}>{accessLevelLabel(level)}</Text>
    </View>
  );
}

export function NativeGroupsAccessGroupCard({
  group,
  tokens,
}: {
  group: GroupsAccessGroup;
  tokens: Tokens;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${group.folder_path}, ${accessLevelLabel(group.access_level)}, участников ${group.member_count}`}
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
    >
      <View style={[styles.iconBox, { backgroundColor: tokens.panelInset }]}>
        <MaterialCommunityIcons name="folder-account-outline" size={24} color={tokens.primary} />
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{group.folder_path}</Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: tokens.textSecondary }]}>{group.branch || 'Без филиала'} · {group.cn}</Text>
        <View style={styles.metaRow}>
          <AccessBadge level={group.access_level} tokens={tokens} />
          <Text style={[styles.count, { color: tokens.textSecondary }]}>{group.member_count} чел.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { minHeight: 92, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  iconBox: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  metaRow: { marginTop: 8, minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { minHeight: 25, borderWidth: 1, borderRadius: 13, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, lineHeight: 13, fontWeight: '900' },
  count: { fontSize: 11, fontWeight: '700' },
});
