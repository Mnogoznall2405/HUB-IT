import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { getHubDashboard } from '../../src/api/hubApi';
import { formatApiError } from '../../src/api/formatError';
import { useAuth } from '../../src/auth/AuthContext';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { hubTheme } from '../../src/theme/hubTheme';
import { officeTokens } from '../../src/theme/officeTokens';

type Kpi = {
  key: string;
  label: string;
  value: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  route?: string;
};

export default function DashboardScreen() {
  const { user, hasPermission } = useAuth();
  const [data, setData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const dash = await getHubDashboard();
      setData(dash as Record<string, unknown>);
    } catch (e: unknown) {
      setError(formatApiError(e, 'Не удалось загрузить главную'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kpis: Kpi[] = [
    {
      key: 'tasks',
      label: 'Открытые задачи',
      value: String(data.tasks_open ?? data.open_tasks ?? '—'),
      icon: 'checkbox-marked-circle-outline',
      route: hasPermission('tasks.read') ? '/(main)/tasks' : undefined,
    },
    {
      key: 'overdue',
      label: 'Просрочено',
      value: String(data.tasks_overdue ?? data.overdue_tasks ?? '—'),
      icon: 'clock-alert-outline',
      route: hasPermission('tasks.read') ? '/(main)/tasks' : undefined,
    },
    {
      key: 'tickets',
      label: 'Билеты',
      value: String(data.tickets_open ?? '—'),
      icon: 'ticket-outline',
      route: hasPermission('tickets.read') ? '/(main)/tickets' : undefined,
    },
    {
      key: 'chat',
      label: 'Чат',
      value: 'Открыть',
      icon: 'forum-outline',
      route: hasPermission('chat.read') ? '/(main)/chat' : undefined,
    },
  ];

  return (
    <HubScreen backgroundColor={officeTokens.pageBg}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.greeting}>
          Здравствуйте, {user?.full_name || user?.username || 'коллега'}
        </Text>
        <Text style={styles.sub}>Обзор HUB-IT — как на web-главной</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.grid}>
          {kpis.map((kpi) => (
            <Pressable
              key={kpi.key}
              disabled={!kpi.route}
              onPress={() => kpi.route && router.push(kpi.route as never)}
              style={({ pressed }) => [styles.kpi, pressed && kpi.route && styles.kpiPressed]}
            >
              <MaterialCommunityIcons name={kpi.icon} size={28} color={hubTheme.primary} />
              <Text style={styles.kpiValue}>{kpi.value}</Text>
              <Text style={styles.kpiLabel}>{kpi.label}</Text>
            </Pressable>
          ))}
        </View>
        <HubCard>
          <Text style={styles.cardTitle}>Быстрые действия</Text>
          {hasPermission('chat.read') ? (
            <Pressable style={styles.linkRow} onPress={() => router.push('/(main)/chat')}>
              <MaterialCommunityIcons name="forum-outline" size={22} color={hubTheme.primary} />
              <Text style={styles.linkText}>Перейти в Chat</Text>
            </Pressable>
          ) : null}
          {hasPermission('settings.read') ? (
            <Pressable style={styles.linkRow} onPress={() => router.push('/(main)/settings')}>
              <MaterialCommunityIcons name="cog-outline" size={22} color={hubTheme.primary} />
              <Text style={styles.linkText}>Настройки профиля</Text>
            </Pressable>
          ) : null}
        </HubCard>
      </ScrollView>
    </HubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 32 },
  greeting: { fontSize: 24, fontWeight: '800', color: officeTokens.textPrimary },
  sub: { fontSize: 14, color: officeTokens.textSecondary, marginTop: 4, marginBottom: 16 },
  error: { color: hubTheme.error, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  kpi: {
    width: '48%',
    backgroundColor: officeTokens.panelBg,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: officeTokens.borderSoft,
    gap: 6,
  },
  kpiPressed: { opacity: 0.85 },
  kpiValue: { fontSize: 22, fontWeight: '700', color: officeTokens.textPrimary },
  kpiLabel: { fontSize: 13, color: officeTokens.textSecondary },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12, color: officeTokens.textPrimary },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  linkText: { fontSize: 16, color: hubTheme.primary, fontWeight: '600' },
});
