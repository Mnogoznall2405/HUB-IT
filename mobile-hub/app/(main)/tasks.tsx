import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { getHubTasks, type HubTask } from '../../src/api/hubApi';
import { formatApiError } from '../../src/api/formatError';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { formatShortTime } from '../../src/utils/formatTime';
import { hubTheme } from '../../src/theme/hubTheme';
import { officeTokens } from '../../src/theme/officeTokens';

export default function TasksScreen() {
  const [items, setItems] = useState<HubTask[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await getHubTasks({ limit: 50 }));
    } catch (e: unknown) {
      setError(formatApiError(e, 'Не удалось загрузить задачи'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <HubScreen backgroundColor={officeTokens.pageBg}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Задачи Hub</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <HubCard style={styles.card}>
            <Text style={styles.taskTitle}>{item.title || item.id}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>{item.status || '—'}</Text>
              {item.due_at ? (
                <Text style={styles.due}>до {formatShortTime(item.due_at)}</Text>
              ) : null}
            </View>
          </HubCard>
        )}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Нет задач</Text> : null}
      />
    </HubScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: officeTokens.textPrimary },
  error: { color: hubTheme.error, marginTop: 8 },
  card: { marginBottom: 10 },
  taskTitle: { fontSize: 16, fontWeight: '600', color: officeTokens.textPrimary },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  meta: { fontSize: 13, color: officeTokens.textSecondary },
  due: { fontSize: 13, color: hubTheme.primary },
  empty: { textAlign: 'center', marginTop: 24, color: officeTokens.textSecondary },
});
