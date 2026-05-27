import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { chatTokens } from '../../theme/chatTokens';

export type ChatFilter = 'all' | 'unread' | 'direct' | 'group';

const FILTERS: { value: ChatFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'unread', label: 'Непрочитанные' },
  { value: 'direct', label: 'Личные' },
  { value: 'group', label: 'Группы' },
];

export function ChatFilterBar({
  value,
  onChange,
}: {
  value: ChatFilter;
  onChange: (next: ChatFilter) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
      {FILTERS.map((filter) => {
        const active = filter.value === value;
        return (
          <Pressable
            key={filter.value}
            onPress={() => onChange(filter.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{filter.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 44 },
  row: { paddingHorizontal: 12, gap: 8, paddingVertical: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  chipActive: { backgroundColor: chatTokens.composerActionBg },
  chipText: { fontSize: 14, color: chatTokens.textPrimary, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
});
