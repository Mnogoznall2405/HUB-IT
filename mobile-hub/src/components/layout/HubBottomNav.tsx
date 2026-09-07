import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { bottomNavMetrics } from '../../navigation/bottomNavMetrics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  getMailNavigationBadgeMeta,
  getNavigationBadgeCount,
  getVisibleNavigationItems,
  resolveActiveBottomNavPath,
  resolveMobileNavigationItems,
  type MobileNavItem,
} from '../../navigation/mobileNavItems';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { useNavUnreadCounts } from '../../navigation/useNavUnreadCounts';
import { hasPendingMobileUpdate, useMobileUpdater } from '../../updates/useMobileUpdater';

export function HubBottomNav({
  currentPath,
  hidden = false,
}: {
  currentPath: string;
  hidden?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const metrics = bottomNavMetrics(fontScale);
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const unreadCounts = useNavUnreadCounts();
  const { state: updateState } = useMobileUpdater();
  const items = useMemo(
    () => resolveMobileNavigationItems({
      selectedPaths: preferences.mobile_bottom_nav_items,
      user,
      hasPermission,
    }),
    [hasPermission, preferences.mobile_bottom_nav_items, user],
  );
  const visibleItems = useMemo(
    () => getVisibleNavigationItems({ user, hasPermission }),
    [hasPermission, user],
  );
  const activePath = resolveActiveBottomNavPath(currentPath, items, visibleItems);

  return (
    <View
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.wrap,
        {
          backgroundColor: tokens.navBg,
          borderColor: tokens.borderSoft,
          bottom: Math.max(insets.bottom, 9),
          shadowColor: tokens.scheme === 'dark' ? '#000' : '#0f172a',
          transform: [{ translateY: hidden ? metrics.contentHeight + insets.bottom + 24 : 0 }],
        },
      ]}
      testID="hub-bottom-nav"
    >
      <View testID="hub-bottom-nav-row" style={[styles.row, { height: metrics.rowHeight }]}>
        {items.map((item) => (
          <NavAction
            key={item.path}
            item={item}
            labelLines={metrics.lines}
            active={activePath === item.path}
            unreadCounts={unreadCounts}
            updateState={updateState}
            tokens={tokens}
            onPress={() => openPortalPath(item.path)}
          />
        ))}
      </View>
    </View>
  );
}

function NavAction({
  item,
  labelLines,
  active,
  unreadCounts,
  updateState,
  tokens,
  onPress,
}: {
  item: MobileNavItem;
  labelLines: number;
  active: boolean;
  unreadCounts: Record<string, unknown>;
  updateState: ReturnType<typeof useMobileUpdater>['state'];
  tokens: ReturnType<typeof useFluentTokens>;
  onPress: () => void;
}) {
  const badgeCount = getNavigationBadgeCount(item.path, unreadCounts);
  const mailBadge = item.path === '/mail'
    ? getMailNavigationBadgeMeta(unreadCounts.mail_state, badgeCount)
    : null;
  const showBadge = mailBadge ? mailBadge.showBadge : badgeCount > 0;
  const badgeContent = mailBadge ? mailBadge.badgeContent : badgeCount;
  const badgeWarning = mailBadge?.needsAttention;
  const showUpdateBadge = item.path === '/menu'
    && hasPendingMobileUpdate(updateState)
    && ['available', 'downloading', 'paused', 'verifying', 'ready', 'installing', 'error'].includes(updateState.status);
  const updateBusy = updateState.status === 'downloading'
    || updateState.status === 'verifying'
    || updateState.status === 'installing';

  return (
    <Pressable
      onPress={onPress}
      style={styles.action}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${item.label}${showUpdateBadge ? '. Доступно обновление приложения' : ''}`}
      testID={`hub-bottom-nav-${item.path.replace(/^\//, '')}`}
    >
      <View
        style={[
          styles.iconShell,
          active && {
            backgroundColor: tokens.scheme === 'dark'
              ? 'rgba(15, 108, 189, 0.24)'
              : 'rgba(15, 108, 189, 0.13)',
          },
        ]}
      >
        <MaterialCommunityIcons
          name={item.icon}
          size={24}
          color={active ? tokens.primary : tokens.iconMuted}
        />
        {showUpdateBadge ? (
          <View testID="hub-bottom-nav-update-badge" style={[styles.badge, styles.updateBadge, { backgroundColor: tokens.primary }]}>
            {updateBusy ? (
              <ActivityIndicator testID="hub-bottom-nav-update-spinner" size={9} color="#fff" />
            ) : (
              <MaterialCommunityIcons name="arrow-down" size={11} color="#fff" />
            )}
          </View>
        ) : showBadge ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: badgeWarning ? tokens.warning : tokens.error },
            ]}
          >
            <Text style={styles.badgeText}>
              {typeof badgeContent === 'number' && badgeContent > 99 ? '99+' : String(badgeContent)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={labelLines}
        style={[
          styles.label,
          {
            color: active ? tokens.primaryLight : tokens.iconMuted,
            fontWeight: active ? '800' : '700',
            fontSize: 11,
          },
        ]}
      >
        {item.shortLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 20,
    elevation: 12,
    borderRadius: 28,
    borderWidth: 1,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  row: {
    height: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  action: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  iconShell: {
    width: 58,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 2,
    maxWidth: '100%',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: 2,
    minWidth: 16,
    minHeight: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 12,
  },
  updateBadge: {
    minWidth: 18,
    width: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 0,
  },
});
