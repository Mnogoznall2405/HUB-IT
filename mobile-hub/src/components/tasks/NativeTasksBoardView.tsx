import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import type { HubTask } from '../../api/taskApi';
import { buildNativeTaskBoardSections } from '../../tasks/nativeTaskViews';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeTaskRow } from './NativeTaskRow';

export function NativeTasksBoardView({
  items,
  total,
  loadingMore,
  refreshing,
  tokens,
  onOpenTask,
  onRefresh,
  onLoadMore,
}: {
  items: HubTask[];
  total: number;
  loadingMore: boolean;
  refreshing: boolean;
  tokens: FluentTokens;
  onOpenTask: (task: HubTask) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}) {
  const allSections = useMemo(() => buildNativeTaskBoardSections(items), [items]);
  const visibleSections = useMemo(() => allSections.filter((section) => section.data.length), [allSections]);
  return (
    <View testID="native-tasks-board" style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summary} accessibilityRole="summary">
        {allSections.map((section) => (
          <View key={section.key} style={[styles.summaryChip, { backgroundColor: `${section.color}18` }]}> 
            <View style={[styles.dot, { backgroundColor: section.color }]} />
            <Text style={[styles.summaryText, { color: section.color }]}>{section.title}: {section.data.length}</Text>
          </View>
        ))}
      </ScrollView>
      <SectionList
        sections={visibleSections}
        keyExtractor={(item) => String(item.id)}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={items.length < total ? onLoadMore : undefined}
        onEndReachedThreshold={0.4}
        stickySectionHeadersEnabled
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={visibleSections.length ? styles.content : styles.emptyContent}
        ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>По выбранным условиям задач нет.</Text>}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={tokens.primary} style={styles.footer} /> : null}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: tokens.pageBg }]}>
            <View style={[styles.dot, { backgroundColor: section.color }]} />
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: section.color }]}>{section.title}</Text>
            <Text style={[styles.sectionCount, { color: tokens.textSecondary }]}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => <NativeTaskRow task={item} tokens={tokens} onPress={onOpenTask} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  summary: { gap: 8, paddingBottom: 8, paddingRight: 28 },
  summaryChip: { minHeight: 36, borderRadius: 18, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7 },
  summaryText: { fontSize: 12, fontWeight: '900' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  content: { paddingBottom: 8 },
  emptyContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  empty: { textAlign: 'center', fontSize: 14 },
  sectionHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { flex: 1, fontSize: 14, fontWeight: '900' },
  sectionCount: { fontSize: 12, fontWeight: '900' },
  footer: { marginVertical: 12 },
});
