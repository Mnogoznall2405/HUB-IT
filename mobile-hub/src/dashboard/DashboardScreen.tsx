import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as chatApi from '../api/chatApi';
import * as docflowApi from '../api/docflowApi';
import type { DocflowInboxSummary } from '../api/docflowApi';
import * as hubApi from '../api/hubApi';
import type { HubDashboard } from '../api/hubApi';
import * as notificationApi from '../api/notificationApi';
import { formatApiError } from '../api/formatError';
import { useAuth } from '../auth/AuthContext';
import { readNativeSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import { NATIVE_CHAT_ENABLED } from '../chat/nativeChatFeature';
import { openNativeNotifications, openPortalPath } from '../navigation/moduleRegistry';
import { useNativeBottomNavInset } from '../navigation/useNativeBottomNavInset';
import { usePreferences } from '../preferences/PreferencesContext';
import {
  normalizeDashboardLayoutSections,
  type DashboardSectionKey,
} from '../preferences/preferenceNormalizers';
import { useFluentTokens, type FluentTokens } from '../theme/fluentTokens';
import { DashboardCustomizeSheet, SECTION_META } from './DashboardCustomizeSheet';
import {
  absenceInitials,
  formatDueLabel,
  formatShortDateTime,
  formatTodayLabel,
  getFirstName,
  getGreeting,
} from './dashboardFormat';
import {
  attentionSecondary,
  buildAttentionItems,
  latestNews,
  listDashboardAbsences,
  listDashboardAnnouncements,
  listDashboardTasks,
  nearestOpenTasks,
} from './dashboardModel';

const EMPTY_DASHBOARD: HubDashboard = {
  announcements: { items: [], total: 0 },
  my_tasks: { items: [], total: 0 },
  unread_counts: {},
  summary: {},
  absences_today: { count: 0, items: [] },
};

type DashboardSnapshot = {
  payload: HubDashboard;
  communicationCounts: { chat: number; mail: number };
  docflowSummary?: DocflowInboxSummary;
};

export function DashboardScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences, savePreferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const bottomInset = useNativeBottomNavInset();
  const [payload, setPayload] = useState<HubDashboard>(EMPTY_DASHBOARD);
  const [communicationCounts, setCommunicationCounts] = useState({ chat: 0, mail: 0 });
  const [docflowSummary, setDocflowSummary] = useState<DocflowInboxSummary>({
    status: 'loading',
    count: null,
    truncated: false,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [customizeSaving, setCustomizeSaving] = useState(false);
  const hasSnapshotRef = useRef(false);
  const payloadRef = useRef<HubDashboard>(EMPTY_DASHBOARD);
  const communicationCountsRef = useRef({ chat: 0, mail: 0 });
  const docflowSummaryRef = useRef<DocflowInboxSummary>({
    status: 'loading',
    count: null,
    truncated: false,
  });

  const canReadTasks = hasPermission('tasks.read');
  const canCreateTasks = hasPermission('tasks.create') || hasPermission('tasks.write');
  const canReadMail = hasPermission('mail.access');
  const canReadChat = NATIVE_CHAT_ENABLED && hasPermission('chat.read');
  const canReadNews = hasPermission('dashboard.read');
  const canReadDocflow = hasPermission('docflow.read');

  const persistDashboardSnapshot = useCallback((nextDocflow = docflowSummaryRef.current) => {
    const userId = Number(user?.id || 0);
    if (!userId) return;
    void writeNativeSnapshot<DashboardSnapshot>('dashboard', userId, {
      payload: payloadRef.current,
      communicationCounts: communicationCountsRef.current,
      docflowSummary: nextDocflow,
    });
  }, [user?.id]);

  const sections = useMemo(() => {
    const normalized = normalizeDashboardLayoutSections(
      preferences.dashboard_sections,
      preferences.dashboard_mobile_sections,
    );
    return normalized.filter((key) => {
      if (key === 'tasks') return canReadTasks;
      if (key === 'absences') return canReadNews;
      if (key === 'communication') {
        return canReadMail || canReadChat || hasPermission('notifications.read');
      }
      if (key === 'news') return canReadNews;
      return true;
    });
  }, [
    canReadChat,
    canReadMail,
    canReadNews,
    canReadTasks,
    hasPermission,
    preferences.dashboard_mobile_sections,
    preferences.dashboard_sections,
  ]);

  const loadDashboard = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'initial') setLoading(true);
    setError('');
    if (offlineMode && mode !== 'refresh') {
      if (!hasSnapshotRef.current) setError('Нет подключения и сохранённых данных главной.');
      setLoading(false);
      return;
    }
    const [dashboardResult, chatResult, mailResult] = await Promise.allSettled([
      hubApi.getHubDashboard(),
      canReadChat ? chatApi.getUnreadSummary() : Promise.resolve(null),
      canReadMail ? notificationApi.getMailUnreadSnapshot() : Promise.resolve(null),
    ]);
    if (dashboardResult.status === 'fulfilled') {
      const nextPayload = dashboardResult.value || EMPTY_DASHBOARD;
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
    } else {
      if (!hasSnapshotRef.current) {
        payloadRef.current = EMPTY_DASHBOARD;
        setPayload(EMPTY_DASHBOARD);
      }
      setError(hasSnapshotRef.current
        ? 'Нет подключения. Показаны сохранённые данные.'
        : formatApiError(dashboardResult.reason, 'Не удалось загрузить главную страницу.'));
    }
    const nextCommunicationCounts = {
      chat: chatResult.status === 'fulfilled'
        ? Number(chatResult.value?.messages_unread_total || 0)
        : communicationCountsRef.current.chat,
      mail: mailResult.status === 'fulfilled'
        ? Number(mailResult.value?.unread_count || 0)
        : communicationCountsRef.current.mail,
    };
    communicationCountsRef.current = nextCommunicationCounts;
    setCommunicationCounts(nextCommunicationCounts);
    if (dashboardResult.status === 'fulfilled') {
      hasSnapshotRef.current = true;
      persistDashboardSnapshot();
    }
    setLoading(false);
    setRefreshing(false);
  }, [canReadChat, canReadMail, offlineMode, persistDashboardSnapshot]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const userId = Number(user?.id || 0);
      const snapshot = userId
        ? await readNativeSnapshot<DashboardSnapshot>('dashboard', userId)
        : null;
      if (!active) return;
      if (snapshot) {
        hasSnapshotRef.current = true;
        payloadRef.current = snapshot.data.payload;
        communicationCountsRef.current = snapshot.data.communicationCounts;
        setPayload(snapshot.data.payload);
        setCommunicationCounts(snapshot.data.communicationCounts);
        if (snapshot.data.docflowSummary) {
          docflowSummaryRef.current = snapshot.data.docflowSummary;
          setDocflowSummary(snapshot.data.docflowSummary);
        }
        setLoading(false);
      }
      void loadDashboard(snapshot ? 'background' : 'initial');
    })();
    return () => {
      active = false;
    };
  }, [loadDashboard, user?.id]);

  useEffect(() => {
    if (!canReadDocflow) return undefined;
    if (offlineMode) {
      if (docflowSummaryRef.current.status === 'loading') {
        setDocflowSummary({ status: 'unavailable', count: null, truncated: false });
      }
      return undefined;
    }
    let active = true;
    setDocflowSummary({ status: 'loading', count: null, truncated: false });
    docflowApi.getInboxSummary()
      .then((result) => {
        if (active) {
          docflowSummaryRef.current = result;
          setDocflowSummary(result);
          persistDashboardSnapshot(result);
        }
      })
      .catch(() => {
        if (active) {
          const unavailable: DocflowInboxSummary = {
            status: 'unavailable',
            count: null,
            truncated: false,
          };
          docflowSummaryRef.current = unavailable;
          setDocflowSummary(unavailable);
        }
      });
    return () => { active = false; };
  }, [canReadDocflow, offlineMode, persistDashboardSnapshot]);

  const taskItems = useMemo(() => listDashboardTasks(payload), [payload]);
  const announcementItems = useMemo(() => listDashboardAnnouncements(payload), [payload]);
  const attentionItems = useMemo(
    () => buildAttentionItems(taskItems, announcementItems, user),
    [announcementItems, taskItems, user],
  );
  const nearestTasks = useMemo(() => nearestOpenTasks(taskItems), [taskItems]);
  const newsItems = useMemo(() => latestNews(announcementItems), [announcementItems]);
  const absences = useMemo(() => listDashboardAbsences(payload), [payload]);
  const unreadCounts = payload.unread_counts || {};

  const handleSaveSections = async (nextSections: DashboardSectionKey[]) => {
    setCustomizeSaving(true);
    try {
      await savePreferences({ dashboard_sections: nextSections });
      setCustomizeOpen(false);
    } catch (saveError) {
      setError(formatApiError(saveError, 'Не удалось сохранить настройку главной страницы.'));
    } finally {
      setCustomizeSaving(false);
    }
  };

  const tasksVisible = sections.includes('tasks');
  const secondaryKeys = sections.filter((key) => (
    key === 'absences' || key === 'communication' || key === 'news'
  ));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.pageBg }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 12 }]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void loadDashboard('refresh'); }}
            tintColor={tokens.primary}
          />
        )}
      >
        <TodayHeader
          tokens={tokens}
          greeting={`${getGreeting()}, ${getFirstName(user)}`}
          todayLabel={formatTodayLabel()}
          loading={loading}
          canCreateTasks={canCreateTasks}
          canReadChat={canReadChat}
          canReadMail={canReadMail}
          onRefresh={() => { void loadDashboard(); }}
          onCustomize={() => setCustomizeOpen(true)}
        />

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: 'rgba(197, 15, 31, 0.08)' }]}>
            <Text style={[styles.errorText, { color: tokens.error }]}>{error}</Text>
          </View>
        ) : null}

        <AttentionBlock
          tokens={tokens}
          loading={loading}
          items={attentionItems}
        />

        {tasksVisible ? (
          <TasksSection
            tokens={tokens}
            loading={loading}
            canReadDocflow={canReadDocflow}
            docflowSummary={docflowSummary}
            tasks={nearestTasks}
          />
        ) : null}

        {secondaryKeys.map((key) => {
          if (key === 'absences') {
            return (
              <AbsencesSection
                key="absences"
                tokens={tokens}
                loading={loading}
                count={absences.count}
                items={absences.items}
              />
            );
          }
          if (key === 'communication') {
            return (
              <CommunicationSection
                key="communication"
                tokens={tokens}
                canReadMail={canReadMail}
                canReadChat={canReadChat}
                mailCount={communicationCounts.mail}
                chatCount={communicationCounts.chat}
                notificationCount={Number(unreadCounts.notifications_unread_total || 0)}
              />
            );
          }
          return (
            <NewsSection
              key="news"
              tokens={tokens}
              loading={loading}
              items={newsItems}
            />
          );
        })}
      </ScrollView>

      <DashboardCustomizeSheet
        open={customizeOpen}
        sections={normalizeDashboardLayoutSections(
          preferences.dashboard_sections,
          preferences.dashboard_mobile_sections,
        )}
        saving={customizeSaving}
        themeMode={preferences.theme_mode}
        onClose={() => setCustomizeOpen(false)}
        onSave={(next) => { void handleSaveSections(next); }}
      />
    </SafeAreaView>
  );
}

function TodayHeader({
  tokens,
  greeting,
  todayLabel,
  loading,
  canCreateTasks,
  canReadChat,
  canReadMail,
  onRefresh,
  onCustomize,
}: {
  tokens: FluentTokens;
  greeting: string;
  todayLabel: string;
  loading: boolean;
  canCreateTasks: boolean;
  canReadChat: boolean;
  canReadMail: boolean;
  onRefresh: () => void;
  onCustomize: () => void;
}) {
  return (
    <View
      testID="dashboard-today-header"
      style={[styles.headerCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      <View style={[styles.headerGlow, { backgroundColor: tokens.primary }]} />
      <View style={styles.headerTop}>
        <View style={styles.headerText}>
          <Text style={[styles.greeting, { color: tokens.textPrimary }]}>{greeting}</Text>
          <Text style={[styles.today, { color: tokens.textSecondary }]}>{todayLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <RoundButton
            tokens={tokens}
            icon={loading ? undefined : 'refresh'}
            label="Обновить главную"
            onPress={onRefresh}
            loading={loading}
          />
          <RoundButton tokens={tokens} icon="tune" label="Настроить главную" onPress={onCustomize} />
        </View>
      </View>
      {canCreateTasks || canReadChat || canReadMail ? (
        <View style={styles.quickRow}>
          {canCreateTasks ? (
            <Pressable
              testID="dashboard-primary-action"
              onPress={() => openPortalPath('/tasks?create=1')}
              style={[styles.primaryAction, { backgroundColor: tokens.primary }]}
            >
              <MaterialCommunityIcons name="clipboard-plus-outline" size={18} color="#fff" />
              <Text style={styles.primaryActionText}>Создать задачу</Text>
            </Pressable>
          ) : null}
          {canReadChat ? (
            <RoundButton
              tokens={tokens}
              icon="forum-outline"
              label="Открыть чат"
              bordered
              onPress={() => openPortalPath('/chat')}
            />
          ) : null}
          {canReadMail ? (
            <RoundButton
              tokens={tokens}
              icon="send-outline"
              label="Написать письмо"
              bordered
              onPress={() => openPortalPath('/mail?compose=new')}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AttentionBlock({
  tokens,
  loading,
  items,
}: {
  tokens: FluentTokens;
  loading: boolean;
  items: ReturnType<typeof buildAttentionItems>;
}) {
  if (loading) {
    return <SkeletonCard tokens={tokens} height={48} />;
  }
  if (!items.length) {
    return (
      <View
        testID="dashboard-section-attention"
        style={[styles.calm, { borderColor: 'rgba(16, 124, 16, 0.2)', backgroundColor: 'rgba(16, 124, 16, 0.055)' }]}
      >
        <MaterialCommunityIcons name="check-circle" size={21} color={tokens.success} />
        <Text style={[styles.calmText, { color: tokens.success }]}>Всё спокойно</Text>
      </View>
    );
  }
  const hasOverdue = items.some((item) => item.kind === 'overdue');
  const attentionColor = hasOverdue ? tokens.error : tokens.warning;
  return (
    <View
      testID="dashboard-section-attention"
      style={[styles.attention, {
        borderColor: attentionColor + '38',
        backgroundColor: attentionColor + '0A',
      }]}
    >
      <View style={[styles.attentionBar, { backgroundColor: attentionColor }]} />
      <View style={styles.sectionHead}>
        <View style={styles.rowCenter}>
          <MaterialCommunityIcons name="alert" size={21} color={attentionColor} />
          <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Требует внимания</Text>
        </View>
        <View style={[styles.countChip, { backgroundColor: attentionColor + '22' }]}>
          <Text style={[styles.countChipText, { color: attentionColor }]}>{items.length}</Text>
        </View>
      </View>
      <View style={styles.gap}>
        {items.map((entry) => (
          <Pressable
            key={`${entry.type}-${entry.id}`}
            testID="dashboard-task-row"
            onPress={() => openPortalPath(
              entry.type === 'announcement'
                ? `/feed?post=${encodeURIComponent(entry.id)}`
                : `/tasks?task=${encodeURIComponent(entry.id)}`,
            )}
            style={[styles.attentionRow, {
              backgroundColor: (entry.kind === 'overdue' ? tokens.error : entry.kind === 'review' || entry.kind === 'ack' ? tokens.warning : tokens.primary) + '0C',
              borderColor: (entry.kind === 'overdue' ? tokens.error : entry.kind === 'review' || entry.kind === 'ack' ? tokens.warning : tokens.primary) + '20',
            }]}
          >
            <View style={[styles.attentionIcon, {
              backgroundColor: (entry.kind === 'overdue' ? tokens.error : entry.kind === 'review' || entry.kind === 'ack' ? tokens.warning : tokens.primary) + '22',
            }]}>
              <MaterialCommunityIcons
                name={entry.type === 'announcement' ? 'bullhorn-outline' : entry.kind === 'overdue' ? 'alert' : entry.kind === 'review' ? 'clipboard-check-outline' : 'comment-outline'}
                size={19}
                color={entry.kind === 'overdue' ? tokens.error : entry.kind === 'review' || entry.kind === 'ack' ? tokens.warning : tokens.primary}
              />
            </View>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.textPrimary }]}>
                {entry.type === 'announcement'
                  ? (entry.item as { title?: string }).title || 'Обязательное объявление'
                  : (entry.item as { title?: string }).title || 'Задача'}
              </Text>
              <Text numberOfLines={1} style={[styles.rowCaption, { color: tokens.textSecondary }]}>
                {attentionSecondary(entry)}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function TasksSection({
  tokens,
  loading,
  canReadDocflow,
  docflowSummary,
  tasks,
}: {
  tokens: FluentTokens;
  loading: boolean;
  canReadDocflow: boolean;
  docflowSummary: DocflowInboxSummary;
  tasks: ReturnType<typeof nearestOpenTasks>;
}) {
  return (
    <Section tokens={tokens} sectionKey="tasks" emphasis actionLabel="Все задачи" onAction={() => openPortalPath('/tasks')}>
      {canReadDocflow ? (
        <Pressable onPress={() => openPortalPath('/docflow')} style={styles.docflowRow}>
          <MaterialCommunityIcons name="clipboard-check-outline" size={22} color={tokens.primary} />
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>Задания 1С</Text>
            <Text style={[styles.rowCaption, { color: tokens.textSecondary }]}>
              {docflowSummary.status === 'loading'
                ? 'Подключаем документооборот…'
                : docflowSummary.status === 'available'
                  ? 'Персональные согласования и поручения'
                  : docflowSummary.status === 'not_configured'
                    ? 'Требуется подключить учётную запись 1С'
                    : 'Данные 1С временно недоступны'}
            </Text>
          </View>
          {docflowSummary.status === 'loading' ? (
            <ActivityIndicator size="small" color={tokens.primary} />
          ) : (
            <View style={[styles.countChip, {
              backgroundColor: docflowSummary.status === 'available' ? tokens.accentSoft : tokens.actionBg,
            }]}>
              <Text style={[styles.countChipText, {
                color: docflowSummary.status === 'available' ? tokens.primary : tokens.textSecondary,
              }]}
              >
                {docflowSummary.status === 'available'
                  ? `${docflowSummary.truncated ? '100+' : Number(docflowSummary.count || 0)}`
                  : '—'}
              </Text>
            </View>
          )}
        </Pressable>
      ) : null}
      {loading ? <SkeletonCard tokens={tokens} height={56} /> : tasks.length ? tasks.map((task) => {
        const overdue = Boolean(task.is_overdue);
        const inReview = String(task.status || '').toLowerCase() === 'review';
        const dueColor = overdue ? tokens.error : inReview ? tokens.warning : task.due_at ? tokens.primary : tokens.iconMuted;
        return (
          <Pressable
            key={String(task.id)}
            onPress={() => openPortalPath(`/tasks?task=${encodeURIComponent(String(task.id))}`)}
            style={styles.taskRow}
          >
            <View style={styles.dotWrap}>
              <View testID="dashboard-task-status-dot" style={[styles.dot, { backgroundColor: dueColor }]} />
            </View>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.textPrimary }]}>
                {task.title || 'Задача'}
              </Text>
              <Text style={[styles.rowCaption, { color: tokens.textSecondary }]}>
                {inReview ? 'Ожидает проверки' : 'Открытая задача'}
              </Text>
            </View>
            <Text style={[styles.dueChip, { color: dueColor, backgroundColor: dueColor + '12' }]}>
              {formatDueLabel(task.due_at)}
            </Text>
          </Pressable>
        );
      }) : (
        <EmptyState tokens={tokens} title="Открытых задач нет" text="Новые задачи появятся здесь автоматически." />
      )}
    </Section>
  );
}

function AbsencesSection({
  tokens,
  loading,
  count,
  items,
}: {
  tokens: FluentTokens;
  loading: boolean;
  count: number;
  items: Array<{ id?: string | number; display_name?: string | null; kind?: string | null; kind_label?: string | null }>;
}) {
  return (
    <Section tokens={tokens} sectionKey="absences">
      {loading ? <SkeletonCard tokens={tokens} height={48} /> : items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.absenceStrip}>
          <View style={[styles.absenceChip, { backgroundColor: tokens.primary }]}>
            <Text style={styles.absenceChipPrimary}>{`${count} отсутствуют`}</Text>
          </View>
          {items.map((item) => (
            <View key={String(item.id)} style={[styles.absenceChip, { borderColor: tokens.borderSoft, borderWidth: 1 }]}>
              <View style={[styles.absenceAvatar, { backgroundColor: tokens.accentSoft }]}>
                <Text style={[styles.absenceInitials, { color: tokens.primary }]}>
                  {absenceInitials(item.display_name)}
                </Text>
              </View>
              <Text numberOfLines={1} style={[styles.absenceName, { color: tokens.textPrimary }]}>
                {`${item.display_name} · ${item.kind_label || item.kind}`}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        <EmptyState tokens={tokens} title="Сегодня все на месте" text="Записи об отпусках и неявках появятся здесь." />
      )}
    </Section>
  );
}

function CommunicationSection({
  tokens,
  canReadMail,
  canReadChat,
  mailCount,
  chatCount,
  notificationCount,
}: {
  tokens: FluentTokens;
  canReadMail: boolean;
  canReadChat: boolean;
  mailCount: number;
  chatCount: number;
  notificationCount: number;
}) {
  const rows = [
    canReadMail ? {
      key: 'mail',
      title: 'Почта',
      secondary: mailCount > 0 ? 'Есть непрочитанные письма' : 'Новых писем нет',
      count: mailCount,
      icon: 'email-outline' as const,
      onPress: () => openPortalPath('/mail'),
    } : null,
    canReadChat ? {
      key: 'chat',
      title: 'Чат',
      secondary: chatCount > 0 ? 'Есть новые сообщения' : 'Новых сообщений нет',
      count: chatCount,
      icon: 'forum-outline' as const,
      onPress: () => openPortalPath('/chat'),
    } : null,
    {
      key: 'notifications',
      title: 'Уведомления',
      secondary: notificationCount > 0
        ? 'Есть события, которые вы ещё не открыли'
        : 'Новых уведомлений нет',
      count: notificationCount,
      icon: 'bell-outline' as const,
      onPress: () => openNativeNotifications(),
    },
  ].filter(Boolean) as Array<{
    key: string;
    title: string;
    secondary: string;
    count: number;
    icon: 'email-outline' | 'forum-outline' | 'bell-outline';
    onPress: () => void;
  }>;

  return (
    <Section tokens={tokens} sectionKey="communication">
      {rows.map((row) => {
        const hasUnread = row.count > 0;
        return (
          <Pressable key={row.key} onPress={row.onPress} style={styles.commRow}>
            <MaterialCommunityIcons
              name={row.icon}
              size={22}
              color={hasUnread ? tokens.primary : tokens.iconMuted}
            />
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>{row.title}</Text>
              <Text numberOfLines={1} style={[styles.rowCaption, { color: tokens.textSecondary }]}>
                {row.secondary}
              </Text>
            </View>
            <Text style={{
              minWidth: 34,
              textAlign: 'right',
              fontWeight: '900',
              fontSize: hasUnread ? 18 : 14,
              color: hasUnread ? tokens.primary : tokens.textDisabled,
            }}
            >
              {hasUnread ? row.count : '—'}
            </Text>
          </Pressable>
        );
      })}
    </Section>
  );
}

function NewsSection({
  tokens,
  loading,
  items,
}: {
  tokens: FluentTokens;
  loading: boolean;
  items: ReturnType<typeof latestNews>;
}) {
  return (
    <Section tokens={tokens} sectionKey="news" actionLabel="Открыть ленту" onAction={() => openPortalPath('/feed')}>
      {loading ? <SkeletonCard tokens={tokens} height={56} /> : items.length ? items.map((item) => (
        <Pressable
          key={String(item.id)}
          onPress={() => openPortalPath(`/feed?post=${encodeURIComponent(String(item.id))}`)}
          style={styles.newsRow}
        >
          <View style={styles.newsMeta}>
            <Text style={[styles.rowCaption, { color: tokens.textSecondary, flex: 1 }]}>
              {formatShortDateTime(item.updated_at || item.published_at || item.created_at)}
            </Text>
            {item.is_ack_pending ? (
              <View style={[styles.importantChip, { borderColor: tokens.warning }]}>
                <Text style={[styles.importantText, { color: tokens.warning }]}>Важно</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: tokens.textPrimary }]}>
            {item.title || 'Объявление'}
          </Text>
          {item.preview ? (
            <Text numberOfLines={2} style={[styles.rowCaption, { color: tokens.textSecondary, marginTop: 2 }]}>
              {item.preview}
            </Text>
          ) : null}
        </Pressable>
      )) : (
        <EmptyState tokens={tokens} title="Новых объявлений нет" text="Последние сообщения компании появятся здесь." />
      )}
    </Section>
  );
}

function Section({
  tokens,
  sectionKey,
  emphasis,
  actionLabel,
  onAction,
  children,
}: {
  tokens: FluentTokens;
  sectionKey: DashboardSectionKey;
  emphasis?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <View testID={`dashboard-section-${sectionKey}`} style={styles.section}>
      {emphasis ? <View style={[styles.emphasisBar, { backgroundColor: tokens.primary }]} /> : null}
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: tokens.textPrimary, fontSize: emphasis ? 17 : 16 }]}>
          {SECTION_META[sectionKey].title}
        </Text>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} style={styles.rowCenter}>
            <Text style={[styles.actionLink, { color: tokens.primary }]}>{actionLabel}</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={tokens.primary} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function EmptyState({ tokens, title, text }: { tokens: FluentTokens; title: string; text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>{title}</Text>
      <Text style={[styles.rowCaption, { color: tokens.textSecondary }]}>{text}</Text>
    </View>
  );
}

function SkeletonCard({ tokens, height }: { tokens: FluentTokens; height: number }) {
  return <View style={[styles.skeleton, { height, backgroundColor: tokens.actionBg }]} />;
}

function RoundButton({
  tokens,
  icon,
  label,
  onPress,
  bordered,
  loading,
}: {
  tokens: FluentTokens;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  bordered?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={[
        styles.roundButton,
        bordered ? { borderWidth: 1, borderColor: tokens.actionBorder, backgroundColor: tokens.panelSolid } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tokens.primary} />
      ) : (
        <MaterialCommunityIcons name={icon || 'refresh'} size={22} color={tokens.primary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 12, gap: 10 },
  headerCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    overflow: 'hidden',
  },
  headerGlow: {
    position: 'absolute',
    width: 220,
    height: 140,
    top: -40,
    left: -40,
    opacity: 0.12,
    borderRadius: 80,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerText: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 20.5, lineHeight: 24, fontWeight: '900', letterSpacing: -0.4 },
  today: { marginTop: 4, fontSize: 13.8 },
  headerActions: { flexDirection: 'row', gap: 4 },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  primaryAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  primaryActionText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  errorBox: { borderRadius: 12, padding: 10 },
  errorText: { fontWeight: '700' },
  calm: {
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calmText: { fontWeight: '800', fontSize: 14 },
  attention: {
    borderRadius: 15,
    borderWidth: 1,
    padding: 12,
    paddingLeft: 16,
    overflow: 'hidden',
  },
  attentionBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  attentionRow: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attentionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: 4 },
  emphasisBar: {
    height: 3,
    borderRadius: 999,
    marginBottom: 4,
  },
  sectionHead: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontWeight: '900', letterSpacing: -0.2 },
  actionLink: { fontWeight: '700', fontSize: 13 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontWeight: '800', fontSize: 14, lineHeight: 18 },
  rowCaption: { fontSize: 12, marginTop: 2 },
  gap: { gap: 6 },
  countChip: {
    minWidth: 30,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countChipText: { fontWeight: '900', fontSize: 12 },
  docflowRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  taskRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  dotWrap: { width: 18, alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dueChip: {
    fontSize: 11,
    fontWeight: '800',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  absenceStrip: { gap: 8, paddingVertical: 4 },
  absenceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 260,
  },
  absenceChipPrimary: { color: '#fff', fontWeight: '800', fontSize: 12 },
  absenceAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  absenceInitials: { fontSize: 10, fontWeight: '800' },
  absenceName: { fontSize: 12, fontWeight: '700', maxWidth: 200 },
  commRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
  },
  newsRow: { minHeight: 68, paddingVertical: 8, paddingHorizontal: 6 },
  newsMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 2, gap: 8 },
  importantChip: {
    height: 22,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  importantText: { fontSize: 11, fontWeight: '800' },
  empty: { padding: 10, gap: 2 },
  skeleton: { borderRadius: 12 },
});
