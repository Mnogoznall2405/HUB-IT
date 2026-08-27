import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HUB_WEB_ORIGIN } from '../../api/config';
import { useAuth } from '../../auth/AuthContext';
import {
  getAccountDisplayName,
  getAccountInitials,
  getAccountSubtitle,
} from '../../dashboard/dashboardFormat';
import { router } from 'expo-router';
import {
  canAccessAdminArea,
  getVisibleNavigationItems,
  type MobileNavItem,
} from '../../navigation/mobileNavItems';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';

function resolveAvatarUrl(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${HUB_WEB_ORIGIN}${raw}`;
  return raw;
}

export function NativeMenuScreen() {
  const { user, hasPermission, logout } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const bottomInset = useNativeBottomNavInset();
  const visibleItems = getVisibleNavigationItems({ user, hasPermission });
  const showAdminArea = canAccessAdminArea({ user, hasPermission });
  const avatarUrl = resolveAvatarUrl(user?.avatar_url);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.pageBg }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 12 }]}>
        <Pressable
          testID="mobile-menu-profile-card"
          onPress={() => router.push('/(shell)/menu/profile' as never)}
          accessibilityLabel={`Открыть профиль: ${getAccountDisplayName(user)}`}
          style={[styles.profileCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
        >
          <View style={[styles.headerGlow, { backgroundColor: tokens.primary }]} />
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: tokens.primary }]}>
              <Text style={styles.avatarText}>{getAccountInitials(user)}</Text>
            </View>
          )}
          <View style={styles.profileText}>
            <Text numberOfLines={1} style={[styles.profileName, { color: tokens.textPrimary }]}>
              {getAccountDisplayName(user)}
            </Text>
            <Text numberOfLines={1} style={[styles.profileSub, { color: tokens.textSecondary }]}>
              {getAccountSubtitle(user)}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={tokens.iconMuted} />
        </Pressable>

        <View testID="mobile-menu-app-grid" style={styles.grid}>
          {visibleItems.map((item) => (
            <GridItem key={item.path} item={item} tokens={tokens} />
          ))}
        </View>

        <View style={[styles.accountCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <AccountAction
            testId="mobile-menu-action-profile"
            tokens={tokens}
            icon="account-outline"
            label="Профиль"
            onPress={() => router.push('/(shell)/menu/profile' as never)}
          />
          <AccountAction
            testId="mobile-menu-action-settings"
            tokens={tokens}
            icon="cog-outline"
            label="Настройки"
            onPress={() => router.push('/(shell)/menu/settings' as never)}
          />
          {showAdminArea ? (
            <AccountAction
              testId="mobile-menu-action-admin"
              tokens={tokens}
              icon="shield-account-outline"
              label="Администрирование"
              onPress={() => router.push('/(shell)/menu/admin' as never)}
            />
          ) : null}
          <AccountAction
            testId="mobile-menu-action-logout"
            tokens={tokens}
            icon="logout"
            label="Выход"
            danger
            onPress={() => {
              void logout().finally(() => router.replace('/(auth)/login'));
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function GridItem({ item, tokens }: { item: MobileNavItem; tokens: FluentTokens }) {
  return (
    <Pressable
      testID={`mobile-menu-item-${item.path.replace(/^\//, '')}`}
      onPress={() => openPortalPath(item.path)}
      style={styles.gridItem}
    >
      <View style={[styles.gridIcon, { backgroundColor: tokens.accentSoft }]}>
        <MaterialCommunityIcons name={item.icon} size={24} color={tokens.primary} />
      </View>
      <Text numberOfLines={1} style={[styles.gridLabel, { color: tokens.textPrimary }]}>
        {item.shortLabel || item.label}
      </Text>
    </Pressable>
  );
}

function AccountAction({
  tokens,
  icon,
  label,
  onPress,
  danger,
  testId,
}: {
  tokens: FluentTokens;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
  testId: string;
}) {
  const color = danger ? tokens.error : tokens.textPrimary;
  return (
    <Pressable testID={testId} onPress={onPress} style={styles.accountRow}>
      <MaterialCommunityIcons name={icon} size={22} color={danger ? tokens.error : tokens.iconMuted} />
      <Text style={[styles.accountLabel, { color }]}>{label}</Text>
      {danger ? null : <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 12, gap: 10 },
  profileCard: {
    minHeight: 72,
    borderRadius: 17,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerGlow: {
    position: 'absolute',
    width: 180,
    height: 120,
    left: -30,
    top: -40,
    opacity: 0.2,
    borderRadius: 80,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  profileText: { flex: 1, minWidth: 0, marginLeft: 10 },
  profileName: { fontWeight: '800', fontSize: 15 },
  profileSub: { marginTop: 2, fontSize: 12 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItem: {
    width: '33.33%',
    minHeight: 82,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  gridIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  gridLabel: {
    width: '100%',
    fontSize: 11.2,
    lineHeight: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  accountCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  accountRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  accountLabel: { flex: 1, fontWeight: '700', fontSize: 15 },
});
