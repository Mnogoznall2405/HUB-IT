import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

export const NativeGroupsAccessGroupCard = memo(function NativeGroupsAccessGroupCard({
  group,
  tokens,
}: {
  group: GroupsAccessGroup;
  tokens: Tokens;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      onPress={() => setExpanded((value) => !value)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessible
      accessibilityLabel={`${group.folder_path}, ${group.branch || 'Без филиала'}, ${group.cn}, ${accessLevelLabel(group.access_level)}, участников ${group.member_count}`}
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
    >
      <View style={[styles.iconBox, { backgroundColor: tokens.panelInset }]}>
        <MaterialCommunityIcons name="folder-account-outline" size={24} color={tokens.primary} />
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={expanded ? undefined : 2} style={[styles.title, { color: tokens.textPrimary }]}>{group.folder_path}</Text>
        <Text numberOfLines={expanded ? undefined : 1} style={[styles.subtitle, { color: tokens.textSecondary }]}>{group.branch || 'Без филиала'} · {group.cn}</Text>
        <View style={styles.metaRow}>
          <AccessBadge level={group.access_level} tokens={tokens} />
          <Text style={[styles.count, { color: tokens.textSecondary }]}>{group.member_count} чел.</Text>
        </View>
        <Text style={[styles.details, { color: tokens.primary }]}>{expanded ? 'Свернуть подробности' : 'Показать подробности'}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { minHeight: 92, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  iconBox: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  metaRow: { marginTop: 8, minHeight: 24, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  badge: { flexShrink: 1, minHeight: 28, borderWidth: 1, borderRadius: 13, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, lineHeight: 17, fontWeight: '900' },
  details: { marginTop: 10, fontSize: 13, lineHeight: 19 },
  count: { fontSize: 12, fontWeight: '700' },
});
