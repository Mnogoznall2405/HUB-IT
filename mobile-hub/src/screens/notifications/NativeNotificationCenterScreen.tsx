import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { formatApiError } from '../../api/formatError';
import { markMailMessageRead } from '../../api/mailApi';
import { listMailboxes } from '../../api/mailMailboxesApi';
import * as notificationApi from '../../api/notificationApi';
import type { HubNotificationItem, MailNotificationItem } from '../../api/notificationApi';
import { useAuth } from '../../auth/AuthContext';
import { readNativeSnapshot, writeNativeSnapshot } from '../../cache/nativeSnapshotCache';
import { publishNativeMailUnreadAbsolute, publishNativeMailUnreadDelta } from '../../mail/nativeMailUnreadEvents';
import { openPortalPath } from '../../navigation/moduleRegistry';
import {
  buildNotificationCenterItems,
  groupNotificationCenterItems,
  hubNotificationPortalPath,
  mailNotificationPortalPath,
  notificationTimeLabel,
  type NotificationCenterItem,
} from '../../notifications/notificationCenter';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

const HUB_LIMIT = 100;
const MAIL_LIMIT = 50;

type NotificationCenterSnapshot = {
  hubItems: HubNotificationItem[];
  mailItems: MailNotificationItem[];
  hubUnread: number;
  mailUnread: number;
};

function notificationIcon(item: NotificationCenterItem): 'email-outline' | 'clipboard-text-outline' | 'bullhorn-outline' | 'forum-outline' | 'bell-outline' {
  if (item.source === 'mail') return 'email-outline';
  if (item.entityType === 'task') return 'clipboard-text-outline';
  if (item.entityType === 'announcement') return 'bullhorn-outline';
  if (item.entityType === 'chat') return 'forum-outline';
  return 'bell-outline';
}

function sourceLabel(item: NotificationCenterItem): string {
  if (item.source === 'mail') return 'Почта';
  if (item.entityType === 'task') return 'Задачи';
  if (item.entityType === 'announcement') return 'Лента';
  if (item.entityType === 'chat') return 'Чат';
  return 'HUB-IT';
}

function NotificationRow({
  item,
  tokens,
  busy,
  onPress,
}: {
  item: NotificationCenterItem;
  tokens: FluentTokens;
  busy: boolean;
  onPress: () => void;
}) {
  const time = notificationTimeLabel(item.createdAt);
  const source = sourceLabel(item);
  return (
    <Pressable
      testID={`native-notification-${item.key}`}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      accessibilityLabel={`${item.unread ? 'Непрочитанное. ' : ''}${source}. ${item.title}${item.body ? `. ${item.body}` : ''}${time ? `. ${time}` : ''}`}
      style={({ pressed }) => [
        styles.notificationRow,
        {
          backgroundColor: item.unread ? tokens.accentSoft : tokens.panelSolid,
          borderColor: item.unread ? tokens.selectedBorder : tokens.borderSoft,
          opacity: busy ? 0.58 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      <View style={[styles.iconShell, { backgroundColor: item.unread ? tokens.selected : tokens.panelInset }]}>
        <MaterialCommunityIcons
          name={notificationIcon(item)}
          size={21}
          color={item.unread ? tokens.primary : tokens.iconMuted}
        />
      </View>
      <View style={styles.notificationBody}>
        <View style={styles.notificationMeta}>
          <View style={styles.sourceRow}>
            {item.unread ? <View style={[styles.unreadDot, { backgroundColor: tokens.primary }]} /> : null}
            <Text style={[styles.sourceText, { color: item.unread ? tokens.primary : tokens.textSecondary }]}>
              {source}
            </Text>
          </View>
          {time ? <Text style={[styles.time, { color: tokens.textTertiary }]}>{time}</Text> : null}
        </View>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{item.title}</Text>
        {item.body ? (
          <Text numberOfLines={2} style={[styles.body, { color: tokens.textSecondary }]}>{item.body}</Text>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={tokens.primary} />
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
      )}
    </Pressable>
  );
}

export function NativeNotificationCenterScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canReadMail = hasPermission('mail.access');
  const canReadHub = ['dashboard.read', 'tasks.read', 'chat.read', 'mail.access']
    .some((permission) => hasPermission(permission));
  const [hubItems, setHubItems] = useState<HubNotificationItem[]>([]);
  const [mailItems, setMailItems] = useState<MailNotificationItem[]>([]);
  const [hubUnread, setHubUnread] = useState(0);
  const [mailUnread, setMailUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const snapshotRef = useRef<NotificationCenterSnapshot>({
    hubItems: [],
    mailItems: [],
    hubUnread: 0,
    mailUnread: 0,
  });

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async (refresh = false) => {
    if (!canReadHub) {
      setLoading(false);
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    const userId = Number(user?.id || 0);
    let cached = false;
    if (!refresh && userId) {
      const snapshot = await readNativeSnapshot<NotificationCenterSnapshot>('notifications', userId);
      if (!mountedRef.current) return;
      if (snapshot) {
        cached = true;
        snapshotRef.current = snapshot.data;
        setHubItems(snapshot.data.hubItems);
        setMailItems(snapshot.data.mailItems);
        setHubUnread(snapshot.data.hubUnread);
        setMailUnread(snapshot.data.mailUnread);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (!cached) setError('Нет подключения и сохранённых уведомлений.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const [hubResult, mailResult] = await Promise.allSettled([
      notificationApi.pollHubNotifications({ limit: HUB_LIMIT, unreadOnly: true }),
      canReadMail
        ? notificationApi.getMailNotificationFeed(MAIL_LIMIT)
        : Promise.resolve(null),
    ]);
    if (!mountedRef.current) return;
    const errors: string[] = [];
    const nextSnapshot = { ...snapshotRef.current };
    if (hubResult.status === 'fulfilled') {
      const nextItems = hubResult.value.items;
      nextSnapshot.hubItems = nextItems;
      nextSnapshot.hubUnread = Math.max(
        0,
        Number(hubResult.value.unread_counts?.notifications_unread_total
          ?? nextItems.filter((item) => item.unread === true || Number(item.unread) === 1).length),
      );
      setHubItems(nextItems);
      setHubUnread(nextSnapshot.hubUnread);
    } else {
      errors.push(formatApiError(hubResult.reason, 'Не удалось загрузить уведомления HUB-IT.'));
    }
    if (mailResult.status === 'fulfilled') {
      if (mailResult.value) {
        nextSnapshot.mailItems = mailResult.value.items;
        nextSnapshot.mailUnread = mailResult.value.total_unread;
        setMailItems(mailResult.value.items);
        setMailUnread(mailResult.value.total_unread);
      }
    } else {
      errors.push(formatApiError(mailResult.reason, 'Не удалось загрузить почтовые уведомления.'));
    }
    snapshotRef.current = nextSnapshot;
    if (userId && (hubResult.status === 'fulfilled' || mailResult.status === 'fulfilled')) {
      void writeNativeSnapshot('notifications', userId, nextSnapshot);
    }
    setError(errors.join(' '));
    setLoading(false);
    setRefreshing(false);
  }, [canReadHub, canReadMail, offlineMode, user?.id]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const items = useMemo(
    () => buildNotificationCenterItems(hubItems, mailItems).filter((item) => item.unread),
    [hubItems, mailItems],
  );
  const sections = useMemo(() => groupNotificationCenterItems(items), [items]);
  const totalUnread = hubUnread + mailUnread;

  const openItem = useCallback((item: NotificationCenterItem) => {
    if (busyKey || markingAll) return;
    setBusyKey(item.key);
    setError('');
    if (item.source === 'hub') {
      const raw = item.raw as HubNotificationItem;
      const destination = hubNotificationPortalPath(raw);
      if (offlineMode) {
        setBusyKey('');
        openPortalPath(destination);
        return;
      }
      setHubItems((current) => current.filter((candidate) => String(candidate.id) !== item.id));
      setHubUnread((current) => Math.max(0, current - 1));
      void notificationApi.markHubNotificationRead(item.id).catch((cause) => {
        if (!mountedRef.current) return;
        setHubItems((current) => current.some((candidate) => String(candidate.id) === item.id)
          ? current
          : [raw, ...current]);
        setHubUnread((current) => current + 1);
        setError(formatApiError(cause, 'Уведомление открылось, но не отметилось прочитанным.'));
      }).finally(() => {
        if (mountedRef.current) setBusyKey('');
      });
      openPortalPath(destination);
      return;
    }
    const raw = item.raw as MailNotificationItem;
    const destination = mailNotificationPortalPath(raw);
    if (offlineMode) {
      setBusyKey('');
      openPortalPath(destination);
      return;
    }
    setMailItems((current) => current.filter((candidate) => !(
      String(candidate.id) === item.id
      && String(candidate.mailbox_id || '') === String(raw.mailbox_id || '')
    )));
    setMailUnread((current) => Math.max(0, current - 1));
    void markMailMessageRead(item.id, String(raw.mailbox_id || '')).then(() => {
      publishNativeMailUnreadDelta(-1);
    }).catch((cause) => {
      if (!mountedRef.current) return;
      setMailItems((current) => current.some((candidate) => (
        String(candidate.id) === item.id
        && String(candidate.mailbox_id || '') === String(raw.mailbox_id || '')
      )) ? current : [raw, ...current]);
      setMailUnread((current) => current + 1);
      setError(formatApiError(cause, 'Письмо открылось, но не отметилось прочитанным.'));
    }).finally(() => {
      if (mountedRef.current) setBusyKey('');
    });
    openPortalPath(destination);
  }, [busyKey, markingAll, offlineMode]);

  const markAll = useCallback(async () => {
    if (offlineMode || totalUnread <= 0 || markingAll) return;
    setMarkingAll(true);
    setError('');
    const shouldMarkHub = hubUnread > 0;
    const shouldMarkMail = canReadMail && mailUnread > 0;
    const markMail = async () => {
      const mailboxes = await listMailboxes(false);
      const mailboxIds = mailboxes
        .filter((mailbox) => mailbox.is_active !== false)
        .map((mailbox) => String(mailbox.id || '').trim())
        .filter(Boolean);
      return notificationApi.markAllMailNotificationsRead(mailboxIds);
    };
    const [hubResult, mailResult] = await Promise.allSettled([
      shouldMarkHub ? notificationApi.markAllHubNotificationsRead() : Promise.resolve(0),
      shouldMarkMail ? markMail() : Promise.resolve(0),
    ]);
    if (!mountedRef.current) return;
    const errors: string[] = [];
    if (hubResult.status === 'fulfilled') {
      if (shouldMarkHub) {
        setHubItems([]);
        setHubUnread(0);
      }
    } else {
      errors.push(formatApiError(hubResult.reason, 'Не удалось прочитать все уведомления HUB-IT.'));
    }
    if (mailResult.status === 'fulfilled') {
      if (shouldMarkMail) {
        setMailItems([]);
        setMailUnread(0);
        publishNativeMailUnreadAbsolute(0);
      }
    } else {
      errors.push(formatApiError(mailResult.reason, 'Не удалось прочитать все письма.'));
    }
    setError(errors.join(' '));
    setMarkingAll(false);
  }, [canReadMail, hubUnread, mailUnread, markingAll, offlineMode, totalUnread]);

  if (!canReadHub) {
    return (
      <AccountScreenScaffold
        title="Уведомления"
        tokens={tokens}
        onBack={() => goBackOrReplace('/(shell)/dashboard')}
      >
        <AccountSectionCard
          tokens={tokens}
          title="Нет доступа"
          description="Центр доступен пользователям главной страницы, задач, чата или почты."
        >
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Уведомления"
      tokens={tokens}
      scroll={false}
      onBack={() => goBackOrReplace('/(shell)/dashboard')}
      rightAction={(
        <View style={styles.headerActions}>
          <Pressable
            testID="native-notifications-settings"
            onPress={() => router.push('/(shell)/menu/settings/notifications' as never)}
            accessibilityRole="button"
            accessibilityLabel="Настройки уведомлений"
            style={styles.headerAction}
          >
            <MaterialCommunityIcons name="cog-outline" size={22} color={tokens.iconMuted} />
          </Pressable>
        </View>
      )}
    >
      <View style={styles.summaryRow}>
        <View style={styles.summaryText}>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.count, { color: tokens.textPrimary }]}
          >
            {loading ? 'Обновляем…' : `Непрочитанных: ${totalUnread}`}
          </Text>
          <Text style={[styles.hint, { color: tokens.textSecondary }]}>Задачи, лента, чат и почта в одной ленте</Text>
        </View>
        <Pressable
          testID="native-notifications-mark-all"
          onPress={() => { void markAll(); }}
          disabled={offlineMode || markingAll || totalUnread <= 0}
          accessibilityRole="button"
          accessibilityLabel="Отметить все уведомления прочитанными"
          accessibilityState={{ disabled: offlineMode || markingAll || totalUnread <= 0, busy: markingAll }}
          style={({ pressed }) => [
            styles.markAll,
            {
              backgroundColor: tokens.actionBg,
              borderColor: tokens.actionBorder,
              opacity: offlineMode || markingAll || totalUnread <= 0 ? 0.5 : pressed ? 0.75 : 1,
            },
          ]}
        >
          {markingAll ? <ActivityIndicator size="small" color={tokens.primary} /> : (
            <MaterialCommunityIcons name="check-all" size={20} color={tokens.primary} />
          )}
          <Text style={[styles.markAllText, { color: tokens.primary }]}>Прочитать все</Text>
        </Pressable>
      </View>
      {offlineMode ? (
        <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: `${tokens.warning}18` }]}>
          <MaterialCommunityIcons name="cloud-off-outline" size={18} color={tokens.warning} />
          <Text style={[styles.bannerText, { color: tokens.warning }]}>Автономный режим: статус прочтения не изменяется.</Text>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {loading && items.length === 0 ? (
        <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View>
      ) : (
        <SectionList
          testID="native-notifications-list"
          sections={sections}
          keyExtractor={(item) => item.key}
          refreshing={refreshing}
          onRefresh={() => { void load(true); }}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
          renderSectionHeader={({ section }) => (
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: tokens.textSecondary }]}>
              {section.title}
            </Text>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
          ListEmptyComponent={(
            <View style={[styles.empty, { backgroundColor: tokens.emptyStateBg, borderColor: tokens.borderSoft }]}>
              <MaterialCommunityIcons name="bell-check-outline" size={34} color={tokens.iconMuted} />
              <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>Всё прочитано</Text>
              <Text style={[styles.emptyBody, { color: tokens.textSecondary }]}>Новые события появятся здесь.</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <NotificationRow
              item={item}
              tokens={tokens}
              busy={busyKey === item.key}
              onPress={() => openItem(item)}
            />
          )}
        />
      )}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  summaryText: { flex: 1, minWidth: 0 },
  count: { fontSize: 15, fontWeight: '800' },
  hint: { marginTop: 2, fontSize: 12, lineHeight: 16 },
  markAll: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  markAllText: { fontSize: 12, fontWeight: '800' },
  banner: { minHeight: 40, borderRadius: 12, paddingHorizontal: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '700' },
  error: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 12 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingBottom: 12 },
  sectionTitle: { paddingVertical: 8, paddingHorizontal: 2, fontSize: 13, fontWeight: '800' },
  sectionSeparator: { height: 4 },
  separator: { height: 8 },
  notificationRow: { minHeight: 96, borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconShell: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  notificationBody: { flex: 1, minWidth: 0 },
  notificationMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sourceRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  sourceText: { fontSize: 11, fontWeight: '800' },
  time: { fontSize: 11, fontWeight: '600' },
  title: { marginTop: 3, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  body: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  empty: { minHeight: 180, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { marginTop: 10, fontSize: 16, fontWeight: '800' },
  emptyBody: { marginTop: 4, textAlign: 'center', fontSize: 13 },
});
