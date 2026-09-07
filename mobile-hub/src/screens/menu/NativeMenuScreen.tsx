import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { useAuth } from '../../auth/AuthContext';
import { HubConnectionInline } from '../../components/layout/HubConnectionHeader';
import {
  getAccountDisplayName,
  getAccountInitials,
  getAccountSubtitle,
} from '../../dashboard/dashboardFormat';
import {
  canAccessAdminArea,
  getVisibleNavigationItems,
  type MobileNavItem,
  type NavIconName,
} from '../../navigation/mobileNavItems';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import { formatMobileUpdateSize } from '../../updates/mobileUpdate';
import {
  hasPendingMobileUpdate,
  useMobileUpdater,
  type MobileUpdaterState,
} from '../../updates/useMobileUpdater';

type MenuRowProps = {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  icon: NavIconName;
  iconColor: string;
  iconBackground: string;
  tokens: FluentTokens;
  onPress: () => void;
  danger?: boolean;
};

const MENU_ICON_TONES = [
  { foreground: '#4aa3ff', background: 'rgba(74, 163, 255, 0.18)' },
  { foreground: '#ff9f1a', background: 'rgba(255, 159, 26, 0.18)' },
  { foreground: '#7f6df2', background: 'rgba(127, 109, 242, 0.18)' },
  { foreground: '#36b37e', background: 'rgba(54, 179, 126, 0.18)' },
  { foreground: '#ef5b70', background: 'rgba(239, 91, 112, 0.18)' },
  { foreground: '#22a6c7', background: 'rgba(34, 166, 199, 0.18)' },
] as const;

function resolveAvatarUrl(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${HUB_WEB_ORIGIN}${raw}`;
  return raw;
}

function toneForPath(path: string) {
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) hash += path.charCodeAt(index);
  return MENU_ICON_TONES[hash % MENU_ICON_TONES.length];
}

export function NativeMenuScreen() {
  const { user, hasPermission, logout } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const bottomInset = useNativeBottomNavInset();
  const updater = useMobileUpdater();
  const visibleItems = getVisibleNavigationItems({ user, hasPermission });
  const workItems = visibleItems.filter((item) => item.group === 'main');
  const toolItems = visibleItems.filter((item) => item.group === 'tools');
  const showAdminArea = canAccessAdminArea({ user, hasPermission });
  const avatarUrl = resolveAvatarUrl(user?.avatar_url);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.pageBg }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 18 }]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          testID="mobile-menu-profile-card"
          onPress={() => router.push('/(shell)/menu/profile' as never)}
          accessibilityRole="button"
          accessibilityLabel={`Открыть профиль: ${getAccountDisplayName(user)}`}
          accessibilityHint="Открывает данные учётной записи и фотографию профиля"
          style={({ pressed }) => [styles.profileHero, pressed && styles.pressed]}
        >
          <View style={[styles.avatarShell, { borderColor: tokens.borderStrong }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: tokens.primary }]}>
                <Text style={styles.avatarText}>{getAccountInitials(user)}</Text>
              </View>
            )}
            <View style={[styles.cameraBadge, { backgroundColor: tokens.primary, borderColor: tokens.pageBg }]}>
              <MaterialCommunityIcons name="camera-outline" size={19} color="#fff" />
            </View>
          </View>
          <View style={styles.profileDetails}>
            <Text numberOfLines={2} style={[styles.profileName, { color: tokens.textPrimary }]}>
              {getAccountDisplayName(user)}
            </Text>
            <Text numberOfLines={1} style={[styles.profileUsername, { color: tokens.textTertiary }]}>
              @{String(user?.username || 'hub').replace(/^@/, '')}
            </Text>
            <Text numberOfLines={2} style={[styles.profileSub, { color: tokens.textSecondary }]}>
              {getAccountSubtitle(user)}
            </Text>
            <HubConnectionInline showHub style={styles.connectionStatus} />
          </View>
        </Pressable>

        {workItems.length ? (
          <MenuSection title="Работа" tokens={tokens}>
            {workItems.map((item) => <ModuleRow key={item.path} item={item} tokens={tokens} />)}
          </MenuSection>
        ) : null}

        {toolItems.length ? (
          <MenuSection title="Инструменты" tokens={tokens}>
            {toolItems.map((item) => <ModuleRow key={item.path} item={item} tokens={tokens} />)}
          </MenuSection>
        ) : null}

        <MenuSection title="Аккаунт" tokens={tokens}>
          <MenuRow
            testID="mobile-menu-action-settings"
            label="Настройки"
            accessibilityLabel="Открыть настройки"
            icon="cog-outline"
            iconColor="#ff9f1a"
            iconBackground="rgba(255, 159, 26, 0.18)"
            tokens={tokens}
            onPress={() => router.push('/(shell)/menu/settings' as never)}
          />
          {showAdminArea ? (
            <MenuRow
              testID="mobile-menu-action-admin"
              label="Администрирование"
              accessibilityLabel="Открыть администрирование"
              icon="shield-account-outline"
              iconColor="#7f6df2"
              iconBackground="rgba(127, 109, 242, 0.18)"
              tokens={tokens}
              onPress={() => router.push('/(shell)/menu/admin' as never)}
            />
          ) : null}
        </MenuSection>

        <MenuSection title="Система" tokens={tokens}>
          <MobileUpdateMenuRow updater={updater} tokens={tokens} />
          <MenuRow
            testID="mobile-menu-action-logout"
            label="Выйти из аккаунта"
            accessibilityLabel="Выйти из аккаунта"
            icon="logout"
            iconColor={tokens.error}
            iconBackground={tokens.scheme === 'dark' ? 'rgba(255, 153, 164, 0.14)' : 'rgba(197, 15, 31, 0.10)'}
            tokens={tokens}
            danger
            onPress={() => {
              void logout().finally(() => router.replace('/(auth)/login'));
            }}
          />
        </MenuSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function MobileUpdateMenuRow({
  updater,
  tokens,
}: {
  updater: ReturnType<typeof useMobileUpdater>;
  tokens: FluentTokens;
}) {
  const { state } = updater;
  const visible = hasPendingMobileUpdate(state) && [
    'available',
    'downloading',
    'paused',
    'verifying',
    'ready',
    'installing',
    'error',
  ].includes(state.status);
  if (!visible || !state.feed) return null;

  const busy = state.status === 'downloading' || state.status === 'verifying' || state.status === 'installing';
  const action = state.canOpenInstallerSettings
    ? 'Разрешить'
    : state.status === 'paused'
      ? 'Продолжить'
      : state.status === 'ready' ? 'Установить' : state.status === 'error' ? 'Повторить' : 'Обновить';
  const subtitle = updateMenuSubtitle(state);
  const showProgress = state.status === 'downloading' || state.status === 'paused';

  return (
    <Pressable
      testID="mobile-menu-update"
      accessibilityRole="button"
      accessibilityLabel={`${action}. HUB-IT ${state.feed.version}. ${subtitle}`}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={() => {
        if (state.canOpenInstallerSettings) void updater.openInstallerSettings();
        else void updater.installUpdate();
      }}
      style={({ pressed }) => [styles.updateRow, pressed && styles.updatePressed]}
    >
      <View style={[styles.rowIcon, { backgroundColor: tokens.accentSoft }]}>
        <MaterialCommunityIcons name="cellphone-arrow-down" size={23} color={tokens.primary} />
      </View>
      <View style={styles.updateBody}>
        <Text numberOfLines={1} style={[styles.updateTitle, { color: tokens.textPrimary }]}>Обновление HUB-IT</Text>
        <Text numberOfLines={2} style={[styles.updateSubtitle, { color: tokens.textSecondary }]}>{subtitle}</Text>
        {showProgress ? (
          <View
            testID="mobile-menu-update-progress"
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(state.progress * 100) }}
            style={[styles.updateTrack, { backgroundColor: tokens.actionBg }]}
          >
            <View style={[styles.updateValue, { backgroundColor: tokens.primary, width: `${Math.round(state.progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator testID="mobile-menu-update-spinner" size="small" color={tokens.primary} />
      ) : (
        <View style={[styles.updateAction, { backgroundColor: tokens.accentSoft }]}>
          <Text style={[styles.updateActionText, { color: tokens.primary }]}>{action}</Text>
        </View>
      )}
    </Pressable>
  );
}

function updateMenuSubtitle(state: MobileUpdaterState): string {
  if (!state.feed) return state.message;
  if (state.status === 'downloading' || state.status === 'paused') {
    const written = formatMobileUpdateSize(state.bytesWritten) || '0 МБ';
    const total = formatMobileUpdateSize(state.totalBytes || state.feed.sizeBytes);
    return `${Math.round(state.progress * 100)}% · ${written} из ${total}`;
  }
  if (state.status === 'verifying') return 'Проверяем APK перед установкой';
  if (state.status === 'installing') return 'Открываем системный установщик Android';
  if (state.status === 'ready') return `Версия ${state.feed.version} уже скачана`;
  if (state.status === 'error') return state.message;
  return `Версия ${state.feed.version} · ${formatMobileUpdateSize(state.feed.sizeBytes)}`;
}

function ModuleRow({ item, tokens }: { item: MobileNavItem; tokens: FluentTokens }) {
  const tone = toneForPath(item.path);
  return (
    <MenuRow
      testID={`mobile-menu-item-${item.path.replace(/^\//, '')}`}
      label={item.label}
      accessibilityLabel={`Открыть ${item.label}`}
      icon={item.icon}
      iconColor={tone.foreground}
      iconBackground={tone.background}
      tokens={tokens}
      onPress={() => openPortalPath(item.path)}
    />
  );
}

function MenuSection({
  title,
  tokens,
  children,
}: {
  title: string;
  tokens: FluentTokens;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: tokens.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        {children}
      </View>
    </View>
  );
}

function MenuRow({
  testID,
  label,
  accessibilityLabel,
  icon,
  iconColor,
  iconBackground,
  tokens,
  onPress,
  danger = false,
}: MenuRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: tokens.actionHover },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBackground }]}>
        <MaterialCommunityIcons name={icon} size={23} color={iconColor} />
      </View>
      <Text numberOfLines={2} style={[styles.rowLabel, { color: danger ? tokens.error : tokens.textPrimary }]}>
        {label}
      </Text>
      {!danger ? <MaterialCommunityIcons name="chevron-right" size={21} color={tokens.iconMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 14, paddingTop: 12, gap: 22 },
  pressed: { opacity: 0.82 },
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8, paddingVertical: 8 },
  profileDetails: { flex: 1, minWidth: 0 },
  avatarShell: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 52, height: 52, borderRadius: 26 },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 25 },
  cameraBadge: {
    position: 'absolute',
    right: -1,
    bottom: 1,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  profileUsername: { marginTop: 3, fontSize: 14, lineHeight: 18, fontWeight: '600' },
  profileSub: { marginTop: 4, fontSize: 13, lineHeight: 18 },
  connectionStatus: { alignSelf: 'flex-start', marginTop: 7 },
  section: { gap: 7 },
  sectionTitle: {
    paddingHorizontal: 8,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCard: { borderRadius: 22, borderWidth: 1, overflow: 'hidden', paddingVertical: 5 },
  row: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  updateRow: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  updatePressed: { transform: [{ scale: 0.96 }] },
  updateBody: { flex: 1, minWidth: 0, gap: 2 },
  updateTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  updateSubtitle: { fontSize: 12, lineHeight: 16 },
  updateTrack: { height: 4, marginTop: 5, borderRadius: 2, overflow: 'hidden' },
  updateValue: { height: 4, borderRadius: 2 },
  updateAction: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  updateActionText: { fontSize: 12, fontWeight: '800' },
});
