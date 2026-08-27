import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../theme/fluentTokens';
import { AddressBookHighlight } from './AddressBookHighlight';
import {
  buildEmployeeSubtitle,
  formatAbsenceLabel,
  getInitials,
  isValidEmailRecipient,
  pickPrimaryEmail,
  pickQuickActionPhone,
  type AddressBookEntry,
} from './addressBookFormat';
import { TelegramBrandIcon } from './MessengerBrandIcon';
import { isPhoneDeepLinkReady } from './messengerLinks';

function absenceTint(kind: string | null | undefined, tokens: FluentTokens) {
  const value = String(kind || '').toLowerCase();
  if (value === 'sick') return { bg: 'rgba(197, 15, 31, 0.12)', color: tokens.error };
  if (value === 'trip') return { bg: tokens.accentSoft, color: tokens.primary };
  if (value === 'vacation') return { bg: 'rgba(142, 86, 46, 0.14)', color: tokens.warning };
  return { bg: tokens.panelMuted, color: tokens.textSecondary };
}

export function AddressBookEntryRow({
  item,
  entryKey,
  query,
  tokens,
  onSelect,
  onCall,
  onOpenTelegram,
  onComposeEmail,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
}: {
  item: AddressBookEntry;
  entryKey: string;
  query: string;
  tokens: FluentTokens;
  onSelect: () => void;
  onCall: (telHref: string) => void;
  onOpenTelegram: (digits: string) => void;
  onComposeEmail: (email: string) => void;
  onOpenChat?: () => void;
  showChatAction?: boolean;
  chatBusy?: boolean;
}) {
  const primaryPhone = pickQuickActionPhone(item);
  const primaryEmail = pickPrimaryEmail(item);
  const subtitle = buildEmployeeSubtitle(item);
  const absenceLabel = formatAbsenceLabel(item.absence);
  const canCall = Boolean(primaryPhone?.telHref);
  const canTelegram = Boolean(primaryPhone?.digits && isPhoneDeepLinkReady(primaryPhone.digits));
  const canMail = Boolean(primaryEmail?.value && isValidEmailRecipient(primaryEmail.value));

  return (
    <Pressable
      onPress={onSelect}
      testID={`address-book-entry-row-${entryKey}`}
      accessibilityRole="button"
      accessibilityLabel={item.full_name || 'Сотрудник'}
      style={[styles.row, { borderBottomColor: tokens.borderSoft }]}
    >
      <View style={[styles.avatar, { backgroundColor: tokens.accentSoft }]}>
        <Text style={[styles.avatarText, { color: tokens.primary }]}>{getInitials(item.full_name)}</Text>
      </View>
      <View style={styles.body}>
        <AddressBookHighlight
          value={item.full_name}
          query={query}
          numberOfLines={1}
          style={[styles.name, { color: tokens.textPrimary }]}
        />
        {subtitle ? (
          <AddressBookHighlight
            value={subtitle}
            query={query}
            numberOfLines={1}
            style={[styles.subtitle, { color: tokens.textSecondary }]}
          />
        ) : null}
        {absenceLabel ? (
          <View style={[styles.chip, { backgroundColor: absenceTint(item.absence?.kind, tokens).bg }]}>
            <Text numberOfLines={1} style={[styles.chipText, { color: absenceTint(item.absence?.kind, tokens).color }]}>
              {absenceLabel}
            </Text>
          </View>
        ) : null}
        {primaryPhone?.value ? (
          <AddressBookHighlight
            value={primaryPhone.value}
            query={query}
            numberOfLines={1}
            style={[styles.phone, { color: tokens.textTertiary }]}
          />
        ) : null}
      </View>
      <View style={styles.actions}>
        {primaryPhone && canCall ? (
          <IconAction
            tokens={tokens}
            icon="phone"
            label={`Позвонить ${primaryPhone.value}`}
            onPress={() => onCall(primaryPhone.telHref)}
          />
        ) : null}
        {primaryPhone ? (
          <IconAction
            tokens={tokens}
            label={`Открыть Telegram ${primaryPhone.value}`}
            disabled={!canTelegram}
            onPress={() => onOpenTelegram(primaryPhone.digits)}
          >
            <TelegramBrandIcon size={20} disabled={!canTelegram} />
          </IconAction>
        ) : null}
        {primaryEmail ? (
          <IconAction
            tokens={tokens}
            icon="email-outline"
            label={`Написать в HUB ${primaryEmail.value}`}
            disabled={!canMail}
            onPress={() => onComposeEmail(primaryEmail.value)}
          />
        ) : null}
        {showChatAction ? (
          <IconAction
            tokens={tokens}
            icon="forum-outline"
            label={`Написать в чат ${item.full_name || ''}`}
            disabled={chatBusy}
            testID={`address-book-chat-${entryKey}`}
            onPress={() => onOpenChat?.()}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function IconAction({
  tokens,
  icon,
  label,
  onPress,
  disabled,
  testID,
  children,
}: {
  tokens: FluentTokens;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  children?: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={[styles.iconButton, disabled ? styles.iconDisabled : null]}
    >
      {children || (
        <MaterialCommunityIcons
          name={icon || 'circle-outline'}
          size={20}
          color={disabled ? tokens.textDisabled : tokens.primary}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '800', fontSize: 13 },
  body: { flex: 1, minWidth: 0 },
  name: { fontWeight: '800', fontSize: 15 },
  subtitle: { marginTop: 2, fontSize: 12 },
  phone: { marginTop: 2, fontSize: 12 },
  chip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: '100%',
  },
  chipText: { fontSize: 11, fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDisabled: { opacity: 0.35 },
});
