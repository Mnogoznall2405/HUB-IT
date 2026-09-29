import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Keyboard, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { hapticSelection } from '../../native/haptics';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { hasPendingMobileUpdate, useMobileUpdater } from '../../updates/useMobileUpdater';

const NAV_SURFACE_ALPHA = 0.92;

function withAlpha(color: string, alpha: number): string {
  const normalized = String(color || '').trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  const expanded = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return normalized;
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `#${expanded}${value.toString(16).padStart(2, '0')}`;
}

export function HubBottomNav({
  currentPath,
  hidden = false,
}: {
  currentPath: string;
  hidden?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    const willHide = Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); willHide.remove(); };
  }, []);
  // Navigation implies the keyboard is gone; without this a missed keyboardDidHide
  // would leave the bar hidden and untouchable.
  useEffect(() => setKeyboardVisible(false), [currentPath]);
  const isHidden = hidden || keyboardVisible;
  const metrics = bottomNavMetrics(fontScale);
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const unreadCounts = useNavUnreadCounts();
  const { state: updateState } = useMobileUpdater();
  const navOffset = useRef(new Animated.Value(isHidden ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      navOffset.setValue(isHidden ? 1 : 0);
      return;
    }
    Animated.timing(navOffset, {
      toValue: isHidden ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isHidden, navOffset, reduceMotion]);
  const hiddenOffset = metrics.contentHeight + insets.bottom + 24;
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
    <Animated.View
      pointerEvents={isHidden ? 'none' : 'auto'}
      accessibilityElementsHidden={isHidden}
      importantForAccessibility={isHidden ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.wrap,
        {
          backgroundColor: withAlpha(tokens.navBg, NAV_SURFACE_ALPHA),
          borderColor: tokens.borderSoft,
          bottom: Math.max(insets.bottom, 9),
          shadowColor: tokens.scheme === 'dark' ? '#000' : '#0f172a',
          opacity: navOffset.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 0.4, 0] }),
          transform: [{
            translateY: navOffset.interpolate({ inputRange: [0, 1], outputRange: [0, hiddenOffset] }),
          }],
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
    </Animated.View>
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

  const reduceMotion = useReducedMotion();
  const activeProgress = useRef(new Animated.Value(active ? 1 : 0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  const badgeScale = useRef(new Animated.Value(1)).current;
  const lastBadgeKeyRef = useRef('');

  useEffect(() => {
    if (reduceMotion) {
      activeProgress.setValue(active ? 1 : 0);
      return;
    }
    Animated.spring(activeProgress, {
      toValue: active ? 1 : 0,
      useNativeDriver: true,
      speed: 32,
      bounciness: 5,
    }).start();
  }, [active, activeProgress, reduceMotion]);

  const badgeKey = showBadge || showUpdateBadge ? `${showBadge}:${badgeContent}:${updateState.status}` : '';
  useEffect(() => {
    if (badgeKey && badgeKey !== lastBadgeKeyRef.current && lastBadgeKeyRef.current !== '' && !reduceMotion) {
      badgeScale.setValue(0.45);
      Animated.spring(badgeScale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 26,
        bounciness: 9,
      }).start();
    } else if (reduceMotion) {
      badgeScale.setValue(1);
    }
    lastBadgeKeyRef.current = badgeKey;
  }, [badgeKey, badgeScale, reduceMotion]);

  const handlePressIn = () => {
    if (reduceMotion) return;
    pressScale.stopAnimation();
    Animated.spring(pressScale, {
      toValue: 0.82,
      useNativeDriver: true,
      speed: 60,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    pressScale.stopAnimation();
    Animated.spring(pressScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 22,
      bounciness: 10,
    }).start();
  };

  const handlePress = () => {
    if (!active) void hapticSelection();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      android_ripple={{ color: tokens.actionHover, borderless: false }}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.9 }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${item.label}${showUpdateBadge ? '. Доступно обновление приложения' : ''}`}
      testID={`hub-bottom-nav-${item.path.replace(/^\//, '')}`}
    >
      <Animated.View style={[styles.iconShell, { transform: [{ scale: pressScale }] }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.activePill,
            {
              backgroundColor: tokens.scheme === 'dark'
                ? 'rgba(15, 108, 189, 0.24)'
                : 'rgba(15, 108, 189, 0.13)',
              opacity: activeProgress,
              transform: [{
                scale: activeProgress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
              }],
            },
          ]}
        />
        <MaterialCommunityIcons
          name={item.icon}
          size={24}
          color={active ? tokens.primary : tokens.iconMuted}
        />
        {showUpdateBadge ? (
          <Animated.View testID="hub-bottom-nav-update-badge" style={[styles.badge, styles.updateBadge, { backgroundColor: tokens.primary, transform: [{ scale: badgeScale }] }]}>
            {updateBusy ? (
              <ActivityIndicator testID="hub-bottom-nav-update-spinner" size={9} color="#fff" />
            ) : (
              <MaterialCommunityIcons name="arrow-down" size={11} color="#fff" />
            )}
          </Animated.View>
        ) : showBadge ? (
          <Animated.View
            style={[
              styles.badge,
              { backgroundColor: badgeWarning ? tokens.warning : tokens.error, transform: [{ scale: badgeScale }] },
            ]}
          >
            <Text style={styles.badgeText}>
              {typeof badgeContent === 'number' && badgeContent > 99 ? '99+' : String(badgeContent)}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>
      <Text
        numberOfLines={labelLines}
        style={[
          styles.label,
          {
            color: active ? tokens.primaryLight : tokens.iconMuted,
            fontWeight: active ? '800' : '700',
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
    borderRadius: 18,
    overflow: 'hidden',
  },
  iconShell: {
    width: 58,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePill: {
    borderRadius: 17,
  },
  label: {
    marginTop: 2,
    maxWidth: '100%',
    fontSize: 11.5,
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
    fontSize: 10,
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
