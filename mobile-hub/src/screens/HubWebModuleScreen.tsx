import * as Linking from 'expo-linking';
import { StyleSheet, Text, View } from 'react-native';
import { HubButton } from '../components/ui/HubButton';
import { HubCard } from '../components/ui/HubCard';
import { HubScreen } from '../components/ui/HubScreen';
import { hubTheme } from '../theme/hubTheme';
import { officeTokens } from '../theme/officeTokens';

const WEB_ORIGIN = 'https://hubit.zsgp.ru';

export function HubWebModuleScreen({
  title,
  webPath,
  description,
}: {
  title: string;
  webPath: string;
  description?: string;
}) {
  const url = `${WEB_ORIGIN}${webPath}`;

  return (
    <HubScreen backgroundColor={officeTokens.pageBg}>
      <HubCard>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>
          {description ||
            'Этот раздел в мобильном приложении открывается в полной web-версии HUB-IT (тот же сайт, что на ПК). Чат, главная и задачи — в нативных экранах слева в меню.'}
        </Text>
        <HubButton mode="contained" onPress={() => Linking.openURL(url)} style={styles.btn}>
          Открыть на hubit.zsgp.ru
        </HubButton>
      </HubCard>
    </HubScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700', color: officeTokens.textPrimary, marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, color: officeTokens.textSecondary, marginBottom: 16 },
  btn: { backgroundColor: hubTheme.primary },
});
