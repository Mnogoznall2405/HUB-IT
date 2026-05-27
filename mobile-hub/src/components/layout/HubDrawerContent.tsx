import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { DrawerContentScrollView, DrawerItem, type DrawerContentComponentProps } from '@react-navigation/drawer';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { filterNavItems } from '../../navigation/navItems';
import { hubTheme } from '../../theme/hubTheme';
import { officeTokens } from '../../theme/officeTokens';
import { PresenceAvatar } from '../chat/PresenceAvatar';

export function HubDrawerContent(props: DrawerContentComponentProps) {
  const { user, logout, hasPermission } = useAuth();
  const items = filterNavItems(hasPermission, user?.role);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.scroll}>
      <View style={styles.brand}>
        <Text style={styles.brandTitle}>HUB-IT</Text>
        <Text style={styles.brandSub}>Мобильный портал</Text>
      </View>
      {user ? (
        <View style={styles.userRow}>
          <PresenceAvatar
            label={user.full_name || user.username}
            avatarUrl={user.avatar_url}
            size={44}
          />
          <View style={styles.userMeta}>
            <Text style={styles.userName} numberOfLines={1}>
              {user.full_name || user.username}
            </Text>
            <Text style={styles.userRole} numberOfLines={1}>
              {user.role}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={styles.menu}>
        {items.map((item) => {
          const focused = props.state.routes[props.state.index]?.name === item.name;
          return (
            <DrawerItem
              key={item.name}
              label={item.label}
              focused={focused}
              activeTintColor={hubTheme.primary}
              inactiveTintColor={officeTokens.textSecondary}
              activeBackgroundColor={officeTokens.selectedBg}
              icon={({ color, size }) => (
                <MaterialCommunityIcons name={item.icon} size={size} color={color} />
              )}
              onPress={() => {
                props.navigation.closeDrawer();
                router.push(`/(main)/${item.name}` as never);
              }}
            />
          );
        })}
      </View>
      <DrawerItem
        label="Выйти"
        icon={({ color, size }) => (
          <MaterialCommunityIcons name="logout" size={size} color={color} />
        )}
        onPress={async () => {
          props.navigation.closeDrawer();
          await logout();
          router.replace('/(auth)/login');
        }}
        inactiveTintColor={hubTheme.error}
      />
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: officeTokens.navBg },
  brand: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: officeTokens.borderSoft,
  },
  brandTitle: { fontSize: 22, fontWeight: '800', color: hubTheme.primary },
  brandSub: { fontSize: 12, color: officeTokens.textSecondary, marginTop: 2 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: officeTokens.borderSoft,
  },
  userMeta: { flex: 1, minWidth: 0 },
  userName: { fontSize: 15, fontWeight: '600', color: officeTokens.textPrimary },
  userRole: { fontSize: 12, color: officeTokens.textSecondary, marginTop: 2 },
  menu: { paddingTop: 4 },
});
