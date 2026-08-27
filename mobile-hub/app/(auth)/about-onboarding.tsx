import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatApiError } from '../../src/api/formatError';
import { useAuth } from '../../src/auth/AuthContext';
import { usePreferences } from '../../src/preferences/PreferencesContext';
import { useFluentTokens } from '../../src/theme/fluentTokens';

const FEATURES = [
  { icon: 'view-dashboard-outline' as const, title: 'Единое рабочее пространство', body: 'Задачи, новости, документы, почта и учёт оборудования доступны в одном приложении.' },
  { icon: 'shield-check-outline' as const, title: 'Корпоративная безопасность', body: 'Доступ определяется вашей ролью, а важные операции требуют подтверждения и защищённой сессии.' },
  { icon: 'sync' as const, title: 'Единые рабочие данные', body: 'Нативные экраны используют актуальные серверные данные HUB-IT на всех ваших устройствах.' },
];

export default function NativeAboutOnboardingScreen() {
  const { completeAboutOnboarding } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const complete = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await completeAboutOnboarding();
      router.replace('/' as never);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось завершить знакомство с HUB-IT.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.pageBg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.logo, { backgroundColor: tokens.primary }]}><Text style={styles.logoText}>H</Text></View>
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.textPrimary }]}>Добро пожаловать в HUB-IT</Text>
        <Text style={[styles.subtitle, { color: tokens.textSecondary }]}>Коротко о том, как устроено ваше рабочее пространство.</Text>
        <View style={styles.features}>
          {FEATURES.map((feature) => (
            <View key={feature.title} style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}> 
              <View style={[styles.icon, { backgroundColor: tokens.accentSoft }]}><MaterialCommunityIcons name={feature.icon} size={24} color={tokens.primary} /></View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>{feature.title}</Text>
                <Text style={[styles.cardText, { color: tokens.textSecondary }]}>{feature.body}</Text>
              </View>
            </View>
          ))}
        </View>
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
        <Pressable
          testID="native-about-onboarding-complete"
          disabled={busy}
          onPress={() => { void complete(); }}
          accessibilityRole="button"
          accessibilityLabel="Начать работу в HUB-IT"
          accessibilityState={{ disabled: busy, busy }}
          style={[styles.button, { backgroundColor: tokens.primary, opacity: busy ? 0.65 : 1 }]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Начать работу</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: 22, paddingTop: 40, paddingBottom: 36 },
  logo: { width: 62, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontSize: 30, fontWeight: '900' },
  title: { marginTop: 22, fontSize: 29, lineHeight: 35, fontWeight: '900' },
  subtitle: { marginTop: 8, fontSize: 15, lineHeight: 22 },
  features: { marginTop: 28, gap: 10 },
  card: { minHeight: 112, borderWidth: 1, borderRadius: 17, padding: 14, flexDirection: 'row', gap: 12 },
  icon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '900' },
  cardText: { marginTop: 5, fontSize: 13, lineHeight: 19 },
  error: { marginTop: 14, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  button: { minHeight: 54, marginTop: 26, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
