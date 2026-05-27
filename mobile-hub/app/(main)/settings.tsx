import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, TextInput } from 'react-native-paper';
import { useAuth } from '../../src/auth/AuthContext';
import * as authApi from '../../src/api/authApi';
import { registerNativePushToken } from '../../src/api/chatApi';
import { PresenceAvatar } from '../../src/components/chat/PresenceAvatar';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { hubTheme } from '../../src/theme/hubTheme';
import { officeTokens } from '../../src/theme/officeTokens';

async function registerPushIfPossible(userId: number) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const tokenData = await Notifications.getDevicePushTokenAsync();
  const token = String(tokenData.data || '').trim();
  if (!token) return;
  await registerNativePushToken(token, `android-${userId}`);
}

export default function SettingsScreen() {
  const { user, logout, refreshUser } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onChangePassword = async () => {
    setBusy(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      Alert.alert('Готово', 'Пароль изменён');
    } catch (e: unknown) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  };

  const onPickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('file', {
      uri: asset.uri,
      name: asset.fileName || 'avatar.jpg',
      type: asset.mimeType || 'image/jpeg',
    } as unknown as Blob);
    await authApi.uploadAvatar(formData);
    await refreshUser();
  };

  const onDeleteAvatar = async () => {
    await authApi.deleteAvatar();
    await refreshUser();
  };

  const onEnablePush = async () => {
    if (!user?.id) return;
    try {
      await registerPushIfPossible(user.id);
      Alert.alert('Готово', 'Push-токен зарегистрирован');
    } catch (e: unknown) {
      Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось включить push');
    }
  };

  const onLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <HubScreen scroll>
      <HubCard>
        <View style={styles.profileRow}>
          <PresenceAvatar
            label={user?.full_name || user?.username || '?'}
            avatarUrl={user?.avatar_url}
            size={72}
          />
          <View style={styles.profileText}>
            <Text style={styles.name}>{user?.full_name || user?.username}</Text>
            <Text style={styles.meta}>@{user?.username}</Text>
            <Text style={styles.meta}>{user?.email || '—'}</Text>
            <Text style={styles.meta}>Роль: {user?.role}</Text>
          </View>
        </View>
        <View style={styles.row}>
          <Button mode="outlined" onPress={onPickAvatar}>
            Сменить аватар
          </Button>
          <Button mode="text" onPress={onDeleteAvatar}>
            Удалить
          </Button>
        </View>
      </HubCard>

      <HubCard style={styles.section}>
        <Text style={styles.sectionTitle}>Смена пароля</Text>
        <TextInput
          label="Текущий пароль"
          value={oldPassword}
          onChangeText={setOldPassword}
          secureTextEntry
          mode="outlined"
          style={styles.field}
        />
        <TextInput
          label="Новый пароль"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          mode="outlined"
          style={styles.field}
        />
        <Button mode="contained" onPress={onChangePassword} loading={busy}>
          Сохранить пароль
        </Button>
      </HubCard>

      <HubCard style={styles.section}>
        <Text style={styles.sectionTitle}>Уведомления</Text>
        <Button mode="outlined" onPress={onEnablePush}>
          Включить push (FCM)
        </Button>
      </HubCard>

      <Button mode="contained" buttonColor={hubTheme.error} textColor="#fff" onPress={onLogout}>
        Выйти
      </Button>
    </HubScreen>
  );
}

const styles = StyleSheet.create({
  profileRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  profileText: { flex: 1 },
  name: { fontSize: 20, fontWeight: '700', color: officeTokens.textPrimary },
  meta: { fontSize: 14, color: officeTokens.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: officeTokens.textPrimary },
  field: { marginBottom: 10 },
});
