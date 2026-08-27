import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PasswordVaultEntry } from '../../api/passwordsApi';
import type { FluentTokens } from '../../theme/fluentTokens';

export function NativePasswordEntryCard({
  entry,
  tokens,
  onPress,
}: {
  entry: PasswordVaultEntry;
  tokens: FluentTokens;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`native-password-entry-${entry.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.login}. Группа ${entry.group || 'не указана'}${entry.is_archived ? '. Архив' : ''}`}
      accessibilityHint="Открывает защищённую карточку записи"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, opacity: pressed ? 0.78 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.panelInset }]}>
        <MaterialCommunityIcons name={entry.is_archived ? 'archive-lock-outline' : 'key-outline'} size={24} color={entry.is_archived ? tokens.textTertiary : tokens.primary} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{entry.login}</Text>
          {entry.is_archived ? <Text style={[styles.archived, { color: tokens.warning }]}>Архив</Text> : null}
        </View>
        <Text numberOfLines={1} style={[styles.group, { color: tokens.textSecondary }]}>{entry.group || 'Без группы'}</Text>
        {entry.description ? <Text numberOfLines={2} style={[styles.description, { color: tokens.textSecondary }]}>{entry.description}</Text> : null}
        {entry.tags.length ? (
          <View style={styles.tags}>
            {entry.tags.slice(0, 4).map((tag) => <Text key={tag} style={[styles.tag, { color: tokens.primary, backgroundColor: tokens.accentSoft }]}>#{tag}</Text>)}
          </View>
        ) : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={21} color={tokens.iconMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 96, borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  archived: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  group: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  description: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  tag: { overflow: 'hidden', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, fontSize: 10, lineHeight: 14, fontWeight: '800' },
});

