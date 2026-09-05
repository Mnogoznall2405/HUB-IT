import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ProgressBar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import { useAuth } from '../auth/AuthContext';
import { officeTokens } from '../theme/officeTokens';
import { formatMobileUpdateSize } from './mobileUpdate';
import { useMobileUpdater } from './useMobileUpdater';

export function MobileUpdateGate() {
  const reduceMotion = useReducedMotion();
  const { logout, user } = useAuth();
  const {
    state,
    checkForUpdate,
    installUpdate,
    openInstallerSettings,
  } = useMobileUpdater();

  const visible = Boolean(user && state.required && state.feed);
  const busy = ['downloading', 'verifying', 'installing'].includes(state.status);
  const actionLabel = state.status === 'paused'
    ? 'Продолжить'
    : state.status === 'ready' ? 'Установить' : 'Скачать и установить';

  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? 'none' : 'fade'}
      presentationStyle="fullScreen"
      onRequestClose={() => undefined}
    >
      <SafeAreaView style={styles.page} accessibilityViewIsModal>
        <ScrollView
          testID="mobile-update-scroll"
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.iconShell}>
              <MaterialCommunityIcons
                name="cellphone-arrow-down"
                size={34}
                color={officeTokens.brand}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </View>
            <Text style={styles.title} accessibilityRole="header">Нужно обновить HUB-IT</Text>
            <Text style={styles.body} accessibilityLiveRegion="polite">{state.message}</Text>
            {state.feed ? (
              <Text style={styles.meta}>
                Версия {state.feed.version} · сборка {state.feed.versionCode || '—'} · {formatMobileUpdateSize(state.feed.sizeBytes)}
              </Text>
            ) : null}
            {state.feed?.changelog.length ? (
              <View style={styles.changelog}>
                {state.feed.changelog.map((item) => (
                  <Text key={item} style={styles.changelogItem}>• {item}</Text>
                ))}
              </View>
            ) : null}
            {state.status === 'downloading' || state.status === 'paused' ? (
              <View
                style={styles.progress}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Загрузка обновления"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(state.progress * 100),
                  text: `${Math.round(state.progress * 100)} процентов`,
                }}
              >
                <ProgressBar progress={state.progress} color={officeTokens.brand} />
                <Text style={styles.progressText}>
                  {Math.round(state.progress * 100)}% · {formatMobileUpdateSize(state.bytesWritten)} из {formatMobileUpdateSize(state.totalBytes)}
                </Text>
              </View>
            ) : null}
            <Button
              mode="contained"
              icon="download"
              onPress={() => { void installUpdate(); }}
              loading={busy}
              disabled={busy}
            >
              {actionLabel}
            </Button>
            {state.canOpenInstallerSettings ? (
              <Button mode="outlined" icon="cog-outline" onPress={() => { void openInstallerSettings(); }}>
                Разрешить установку APK
              </Button>
            ) : null}
            <Button mode="text" icon="refresh" onPress={() => { void checkForUpdate(); }} disabled={busy}>
              Проверить снова
            </Button>
            <Button mode="text" onPress={() => { void logout(); }} disabled={busy}>
              Выйти из учётной записи
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: officeTokens.pageBg,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 440, gap: 13 },
  iconShell: {
    width: 58,
    height: 58,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: officeTokens.selectedBg,
  },
  title: { color: officeTokens.textPrimary, fontSize: 23, lineHeight: 29, fontWeight: '900', textAlign: 'center' },
  body: { color: officeTokens.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  meta: { color: officeTokens.textSecondary, fontSize: 12, textAlign: 'center' },
  changelog: { padding: 12, borderRadius: 12, backgroundColor: officeTokens.panelBg },
  changelogItem: { color: officeTokens.textSecondary, fontSize: 13, lineHeight: 19 },
  progress: { gap: 5 },
  progressText: { color: officeTokens.textSecondary, fontSize: 12, textAlign: 'right' },
});
