import { router } from 'expo-router';
import { Linking, StyleSheet, Text } from 'react-native';
import { HubButton } from '../../src/components/ui/HubButton';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { hubTheme } from '../../src/theme/hubTheme';

const WEB_LOGIN_URL = 'https://hubit.zsgp.ru/login';

export default function SetupRequiredScreen() {
  return (
    <HubScreen>
      <HubCard>
        <Text style={styles.title}>Нужна настройка 2FA</Text>
        <Text style={styles.body}>
          Для вашего аккаунта требуется первичная настройка двухфакторной аутентификации. Сделайте это
          в web-версии HUB-IT, затем войдите в мобильное приложение снова.
        </Text>
        <HubButton mode="contained" onPress={() => Linking.openURL(WEB_LOGIN_URL)} style={styles.btn}>
          Открыть web
        </HubButton>
        <HubButton mode="text" onPress={() => router.replace('/(auth)/login')}>
          Назад к входу
        </HubButton>
      </HubCard>
    </HubScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12, color: hubTheme.textPrimary },
  body: { fontSize: 15, lineHeight: 22, color: hubTheme.textSecondary, marginBottom: 16 },
  btn: { marginBottom: 8 },
});
