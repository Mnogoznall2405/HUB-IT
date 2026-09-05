import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { useAppFluentTokens } from '../../theme/fluentTokens';

export function BrandedLoader({ label = 'Проверяем защищённую сессию' }: { label?: string }) {
  const tokens = useAppFluentTokens();
  const { vpnActive } = useAuth();
  const imageBorder = tokens.scheme === 'dark'
    ? 'rgba(255, 255, 255, 0.10)'
    : 'rgba(0, 0, 0, 0.10)';

  return (
    <View style={[styles.wrap, { backgroundColor: tokens.pageBg }]}>
      <View style={[styles.brandMark, { backgroundColor: tokens.accentSoft }]}>
        <Image
          source={require('../../../assets/icon.png')}
          style={[styles.logo, { borderColor: imageBorder }]}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>
      <Text style={[styles.title, { color: tokens.textPrimary }]} accessibilityRole="header">HUB-IT</Text>
      <View style={styles.statusRow} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={tokens.primary} />
        <Text style={[styles.label, { color: tokens.textSecondary }]}>{label}</Text>
      </View>
      <Text style={[styles.caption, { color: tokens.textTertiary }]}>Открываем только необходимые данные</Text>
      {vpnActive ? (
        <View
          testID="startup-vpn-notice"
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel="VPN может замедлять подключение. Если HUB загружается долго, временно отключите VPN."
          style={[
            styles.vpnNotice,
            { backgroundColor: tokens.panelSolid, borderColor: tokens.border },
          ]}
        >
          <View style={[styles.vpnIcon, { backgroundColor: tokens.accentSoft }]}>
            <MaterialCommunityIcons
              name="shield-alert-outline"
              size={22}
              color={tokens.primaryLight}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
          <View style={styles.vpnCopy}>
            <Text style={[styles.vpnTitle, { color: tokens.textPrimary }]}>VPN может замедлять подключение</Text>
            <Text style={[styles.vpnBody, { color: tokens.textSecondary }]}>Если HUB загружается долго, временно отключите VPN.</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandMark: {
    width: 84,
    height: 84,
    borderRadius: 26,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  logo: {
    width: 68,
    height: 68,
    borderRadius: 18,
    borderWidth: 1,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  statusRow: {
    minHeight: 28,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  caption: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  vpnNotice: {
    width: '100%',
    maxWidth: 380,
    minHeight: 72,
    marginTop: 28,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  vpnIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vpnCopy: { flex: 1, minWidth: 0 },
  vpnTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  vpnBody: { marginTop: 2, fontSize: 12, lineHeight: 17 },
});
