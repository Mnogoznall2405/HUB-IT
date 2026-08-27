import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

export function HubBottomNav({
  currentPath,
  hidden = false,
}: {
  currentPath: string;
  hidden?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const unreadCounts = useNavUnreadCounts();
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
      style={[
        styles.wrap,
        {
          backgroundColor: tokens.navBg,
          paddingBottom: insets.bottom,
          shadowColor: tokens.scheme === 'dark' ? '#000' : '#0f172a',
          transform: [{ translateY: hidden ? 120 : 0 }],
        },
      ]}
      testID="hub-bottom-nav"
    >
      <View style={styles.row}>
        {items.map((item) => (
          <NavAction
            key={item.path}
            item={item}
            active={activePath === item.path}
            unreadCounts={unreadCounts}
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
  active,
  unreadCounts,
  tokens,
  onPress,
}: {
  item: MobileNavItem;
  active: boolean;
  unreadCounts: Record<string, unknown>;
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

  return (
    <Pressable
      onPress={onPress}
      style={styles.action}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.shortLabel}
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
        {showBadge ? (
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
        numberOfLines={1}
        style={[
          styles.label,
          {
            color: active ? tokens.textPrimary : tokens.iconMuted,
            fontWeight: active ? '800' : '700',
            fontSize: active ? 11.4 : 11,
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
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 12,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -8 },
  },
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  iconShell: {
    width: 56,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 2,
    maxWidth: '100%',
    fontSize: 11,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: 2,
    minWidth: 16,
    height: 16,
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
});
