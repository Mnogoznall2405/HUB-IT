import { NativeModal as Modal } from '../../components/ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState, useContext, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import type { FluentTokens } from '../../theme/fluentTokens';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';

export function AccountScreenScaffold({
  title,
  onBack,
  tokens,
  children,
  rightAction,
  refreshing = false,
  onRefresh,
  scroll = true,
  footer,
  includeBottomNav = true,
  backTestID = 'account-header-back',
}: {
  title: string;
  onBack?: () => void;
  tokens: FluentTokens;
  children: ReactNode;
  rightAction?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  footer?: ReactNode;
  includeBottomNav?: boolean;
  backTestID?: string;
}) {
  const navInset = useNativeBottomNavInset();
  const safeInsets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const bottomInset = includeBottomNav ? navInset : (safeInsets?.bottom || 0);
  const body = (
    <View style={[styles.body, { paddingBottom: bottomInset + 12 }]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.pageBg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: tokens.borderSoft, backgroundColor: tokens.headerBandBg }]}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Назад"
            style={styles.backButton}
            testID={backTestID}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color={tokens.textPrimary} />
          </Pressable>
        ) : <View style={styles.backButton} />}
        <Text numberOfLines={1} style={[styles.headerTitle, { color: tokens.textPrimary }]}>{title}</Text>
        <View style={styles.headerRight}>{rightAction}</View>
      </View>
      {scroll ? (
        <KeyboardAvoidingView
          testID="account-keyboard-avoiding-host"
          style={styles.flex}
          {...chatKeyboardAvoidingProps()}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.scroll, { paddingBottom: footer ? 12 : bottomInset + 12 }]}
            refreshControl={onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.primary} />
            ) : undefined}
          >
            {children}
          </ScrollView>
          {footer ? <View style={{ padding: 12, paddingBottom: bottomInset + 12, backgroundColor: tokens.panelSolid }}>{footer}</View> : null}
        </KeyboardAvoidingView>
      ) : body}
    </SafeAreaView>
  );
}

export function AccountSubpage({ visible, title, tokens, onClose, children, footer }: {
  visible: boolean;
  title: string;
  tokens: FluentTokens;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <AccountScreenScaffold title={title} tokens={tokens} onBack={onClose} footer={footer} includeBottomNav={false} backTestID="account-subpage-back">
        {children}
      </AccountScreenScaffold>
    </Modal>
  );
}

export function AccountSectionCard({ tokens, title, description, children, collapsible = false }: {
  tokens: FluentTokens;
  title?: string;
  description?: string;
  children: ReactNode;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.card, collapsible && !expanded ? { paddingVertical: 2 } : undefined, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      {collapsible ? (
        <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.cardTitle, { flex: 1, color: tokens.textPrimary }]}>{title}</Text>
          <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={tokens.iconMuted} />
        </Pressable>
      ) : title ? <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>{title}</Text> : null}
      {!collapsible || expanded ? <>
        {description ? <Text style={[styles.cardDescription, { color: tokens.textSecondary }]}>{description}</Text> : null}
        <View style={title || description ? styles.cardBody : undefined}>{children}</View>
      </> : null}
    </View>
  );
}

export function AccountActionRow({
  tokens,
  icon,
  label,
  subtitle,
  onPress,
  danger,
  testID,
}: {
  tokens: FluentTokens;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
}) {
  const color = danger ? tokens.error : tokens.textPrimary;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.row}>
      {icon ? (
        <MaterialCommunityIcons name={icon} size={22} color={danger ? tokens.error : tokens.iconMuted} />
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color }]}>{label}</Text>
        {subtitle ? <Text style={[styles.rowSub, { color: tokens.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
    </Pressable>
  );
}

export function AccountField({
  tokens,
  label,
  value,
}: {
  tokens: FluentTokens;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: tokens.textPrimary }]}>{value || '—'}</Text>
    </View>
  );
}

export function AccountStatusText({
  tokens,
  error,
  message,
}: {
  tokens: FluentTokens;
  error?: string;
  message?: string;
}) {
  if (error) return <Text style={[styles.status, { color: tokens.error }]}>{error}</Text>;
  if (message) return <Text style={[styles.status, { color: tokens.success }]}>{message}</Text>;
  return null;
}

export function AccountPrimaryButton({
  tokens,
  label,
  onPress,
  disabled,
  loading = false,
  danger,
  testID,
}: {
  tokens: FluentTokens;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const blocked = Boolean(disabled || loading);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: danger ? tokens.error : tokens.primary,
          opacity: disabled && !loading ? 0.55 : pressed ? 0.88 : 1,
          transform: [{ scale: pressed && !blocked ? 0.96 : 1 }],
        },
      ]}
    >
      {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.buttonLabel}>{label}</Text>}
    </Pressable>
  );
}

export function AccountSecondaryButton({
  tokens,
  label,
  onPress,
  disabled,
  loading = false,
  danger,
  testID,
}: {
  tokens: FluentTokens;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const blocked = Boolean(disabled || loading);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        styles.buttonSecondary,
        {
          borderColor: danger ? tokens.error : tokens.border,
          opacity: disabled && !loading ? 0.55 : pressed ? 0.88 : 1,
          transform: [{ scale: pressed && !blocked ? 0.96 : 1 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={danger ? tokens.error : tokens.textPrimary} />
      ) : (
        <Text style={[styles.buttonSecondaryLabel, { color: danger ? tokens.error : tokens.textPrimary }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function AccountLoading({ tokens }: { tokens: FluentTokens }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={tokens.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
  },
  headerRight: {
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 8,
  },
  scroll: { padding: 12, gap: 10 },
  body: { flex: 1, padding: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 12,
  },
  cardTitle: { fontWeight: '800', fontSize: 15 },
  cardDescription: { marginTop: 4, fontSize: 12, lineHeight: 16 },
  cardBody: { marginTop: 10 },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontWeight: '700', fontSize: 15 },
  rowSub: { marginTop: 2, fontSize: 12 },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  fieldValue: { marginTop: 2, fontSize: 15, fontWeight: '700' },
  status: { fontSize: 13, fontWeight: '600' },
  button: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonLabel: { color: '#fff', fontWeight: '800', fontSize: 14 },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonSecondaryLabel: { fontWeight: '800', fontSize: 14 },
  loading: { paddingVertical: 24, alignItems: 'center' },
});
