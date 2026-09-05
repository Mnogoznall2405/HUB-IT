import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MfuDevice } from '../../api/mfuApi';
import { minimumMfuSupplyPercent } from '../../mfu/nativeMfuModel';
import type { FluentTokens } from '../../theme/fluentTokens';

function pingLabel(status: MfuDevice['ping']['status']): string {
  if (status === 'online') return 'В сети';
  if (status === 'offline') return 'Оффлайн';
  return 'Неизвестно';
}

export const NativeMfuDeviceCard = memo(function NativeMfuDeviceCard({ device, tokens, onPress }: { device: MfuDevice; tokens: FluentTokens; onPress: (device: MfuDevice) => void }) {
  const minimum = minimumMfuSupplyPercent(device);
  const pingColor = device.ping.status === 'online' ? tokens.success : (device.ping.status === 'offline' ? tokens.error : tokens.textTertiary);
  const handlePress = useCallback(() => onPress(device), [device, onPress]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${device.model_name || device.type_name}. ${pingLabel(device.ping.status)}. ${device.branch_name}, ${device.location_name}`}
      accessibilityHint="Открывает подробности МФУ"
      style={({ pressed }) => [styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, opacity: pressed ? 0.76 : 1 }]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.panelInset }]}><MaterialCommunityIcons name="printer" size={25} color={tokens.primary} /></View>
      <View style={styles.content}>
        <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{device.model_name || device.type_name || 'МФУ'}</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>{device.inv_no || device.hostname || device.ip_address || 'Без идентификатора'}</Text>
        <Text numberOfLines={1} style={[styles.meta, { color: tokens.textSecondary }]}>{device.branch_name || 'Без филиала'} · {device.location_name || 'Без локации'}</Text>
        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: tokens.panelInset }]}><View style={[styles.dot, { backgroundColor: pingColor }]} /><Text style={[styles.badgeText, { color: tokens.textPrimary }]}>{pingLabel(device.ping.status)}</Text></View>
          {minimum !== null ? <View style={[styles.badge, { backgroundColor: tokens.panelInset, borderColor: minimum < 20 ? tokens.error : 'transparent', borderWidth: minimum < 20 ? 1 : 0 }]}><Text style={[styles.badgeText, { color: minimum < 20 ? tokens.error : tokens.textPrimary }]}>Расходник {Math.round(minimum)}%</Text></View> : null}
          {device.snmp.page_total !== null ? <View style={[styles.badge, { backgroundColor: tokens.panelInset }]}><Text style={[styles.badgeText, { color: tokens.textPrimary }]}>{Math.round(device.snmp.page_total)} стр.</Text></View> : null}
        </View>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={tokens.iconMuted} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { minHeight: 112, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  meta: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  badges: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { minHeight: 25, borderRadius: 13, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: '800' },
});
