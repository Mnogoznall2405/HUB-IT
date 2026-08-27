import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ComputerRecord } from '../../api/computersApi';
import {
  computerDiskWarningCount,
  computerStatusLabel,
  computerStatusTone,
  formatComputerAge,
} from '../../computers/nativeComputersModel';
import type { FluentTokens } from '../../theme/fluentTokens';

function toneColor(tone: ReturnType<typeof computerStatusTone>, tokens: FluentTokens): string {
  if (tone === 'success') return tokens.success;
  if (tone === 'warning') return tokens.warning;
  if (tone === 'error') return tokens.error;
  return tokens.textTertiary;
}

function Detail({ icon, value, tokens }: { icon: 'account-outline' | 'map-marker-outline' | 'ip-network-outline'; value: string; tokens: FluentTokens }) {
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <MaterialCommunityIcons name={icon} size={16} color={tokens.iconMuted} />
      <Text numberOfLines={1} style={[styles.detailText, { color: tokens.textSecondary }]}>{value}</Text>
    </View>
  );
}

export function NativeComputerCard({
  computer,
  tokens,
  onPress,
}: {
  computer: ComputerRecord;
  tokens: FluentTokens;
  onPress: () => void;
}) {
  const statusTone = computerStatusTone(computer.status);
  const diskWarnings = computerDiskWarningCount(computer);
  const user = computer.user_full_name || computer.user_login || computer.current_user;
  const place = [computer.branch_name, computer.location_name].filter(Boolean).join(' · ');
  const badges = [
    computer.has_hardware_changes || computer.changes_count_30d > 0 ? `${Math.max(1, computer.changes_count_30d)} изм.` : '',
    diskWarnings > 0 ? `${diskWarnings} диск.` : '',
    computer.is_unassigned ? 'Без привязки' : '',
  ].filter(Boolean);

  return (
    <Pressable
      testID={`native-computer-${computer.mac_address || computer.hostname}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${computer.hostname}. ${computerStatusLabel(computer.status)}. ${computer.ip_primary || 'IP не указан'}`}
      accessibilityHint="Открывает карточку компьютера"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, opacity: pressed ? 0.78 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.panelInset }]}>
        <MaterialCommunityIcons name="desktop-tower-monitor" size={25} color={tokens.primary} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{computer.hostname}</Text>
          <View style={styles.status}>
            <View style={[styles.statusDot, { backgroundColor: toneColor(statusTone, tokens) }]} />
            <Text style={[styles.statusText, { color: toneColor(statusTone, tokens) }]}>{computerStatusLabel(computer.status)}</Text>
          </View>
        </View>
        <Text style={[styles.age, { color: tokens.textTertiary }]}>{formatComputerAge(computer.age_seconds)}</Text>
        <Detail icon="account-outline" value={user} tokens={tokens} />
        <Detail icon="map-marker-outline" value={place} tokens={tokens} />
        <Detail icon="ip-network-outline" value={computer.ip_primary || computer.mac_address} tokens={tokens} />
        {badges.length ? (
          <View style={styles.badges}>
            {badges.map((badge) => (
              <View key={badge} style={[styles.badge, { backgroundColor: tokens.panelInset }]}>
                <Text style={[styles.badgeText, { color: badge.includes('диск') ? tokens.warning : tokens.textSecondary }]}>{badge}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={21} color={tokens.iconMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 116, borderWidth: 1, borderRadius: 16, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '800' },
  age: { marginTop: 1, marginBottom: 5, fontSize: 11, lineHeight: 15 },
  detail: { minHeight: 21, flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailText: { flex: 1, fontSize: 12, lineHeight: 17 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  badge: { minHeight: 24, borderRadius: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: '800' },
});
