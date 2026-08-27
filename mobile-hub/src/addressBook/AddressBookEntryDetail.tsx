import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FluentTokens } from '../theme/fluentTokens';
import { AddressBookHighlight } from './AddressBookHighlight';
import {
  formatAbsenceLabel,
  formatAge,
  formatDate,
  isValidEmailRecipient,
  normalizePhoneDigits,
  normalizeText,
  pickPrimaryEmail,
  pickPrimaryPhone,
  type AddressBookEmail,
  type AddressBookEntry,
  type AddressBookPhone,
} from './addressBookFormat';
import { MaxBrandIcon, TelegramBrandIcon } from './MessengerBrandIcon';
import { isPhoneDeepLinkReady } from './messengerLinks';

function absenceTint(kind: string | null | undefined, tokens: FluentTokens) {
  const value = String(kind || '').toLowerCase();
  if (value === 'sick') return { bg: 'rgba(197, 15, 31, 0.12)', color: tokens.error };
  if (value === 'trip') return { bg: tokens.accentSoft, color: tokens.primary };
  if (value === 'vacation') return { bg: 'rgba(142, 86, 46, 0.14)', color: tokens.warning };
  return { bg: tokens.panelMuted, color: tokens.textSecondary };
}

export function AddressBookEntryDetail({
  item,
  query,
  tokens,
  onCopy,
  onCall,
  onOpenTelegram,
  onOpenMax,
  onComposeEmail,
  onOpenExternalMail,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
}: {
  item: AddressBookEntry;
  query: string;
  tokens: FluentTokens;
  onCopy: (value: string) => void;
  onCall: (telHref: string) => void;
  onOpenTelegram: (digits: string) => void;
  onOpenMax: (digits: string) => void;
  onComposeEmail: (email: string) => void;
  onOpenExternalMail: (email: string) => void;
  onOpenChat?: () => void;
  showChatAction?: boolean;
  chatBusy?: boolean;
}) {
  const primaryPhone = pickPrimaryPhone(item);
  const primaryEmail = pickPrimaryEmail(item);
  const absenceLabel = formatAbsenceLabel(item.absence);
  const ageLabel = formatAge(item.age);
  const hireDateLabel = formatDate(item.hire_date);
  const canCall = Boolean(primaryPhone?.telHref);
  const canTelegram = Boolean(primaryPhone?.digits && isPhoneDeepLinkReady(primaryPhone.digits));
  const canMail = Boolean(primaryEmail?.value && isValidEmailRecipient(primaryEmail.value));
  const meta = [item.position || 'Должность не указана', ageLabel].filter(Boolean).join(' · ');

  return (
    <View testID="address-book-entry-detail" style={styles.root}>
      <View style={styles.identity}>
        <AddressBookHighlight
          value={item.full_name}
          query={query}
          style={[styles.title, { color: tokens.textPrimary }]}
        />
        <AddressBookHighlight
          value={meta}
          query={query}
          style={[styles.meta, { color: tokens.textSecondary }]}
          testID="address-book-person-meta"
        />
        {hireDateLabel ? (
          <Text
            testID="address-book-hire-date"
            style={[styles.meta, { color: tokens.textSecondary }]}
          >
            Дата приёма: {hireDateLabel}
          </Text>
        ) : null}
      </View>
      {absenceLabel ? (
        <View
          testID="address-book-absence-chip"
          style={[styles.chip, { backgroundColor: absenceTint(item.absence?.kind, tokens).bg }]}
        >
          <Text style={[styles.chipText, { color: absenceTint(item.absence?.kind, tokens).color }]}>
            {absenceLabel}
          </Text>
        </View>
      ) : null}

      <View style={styles.primaryActions}>
        {canCall && primaryPhone ? (
          <PrimaryButton
            tokens={tokens}
            filled
            icon="phone"
            label="Позвонить"
            accessibilityLabel={`Позвонить ${primaryPhone.value}`}
            onPress={() => onCall(primaryPhone.telHref)}
          />
        ) : null}
        {primaryPhone ? (
          <PrimaryButton
            tokens={tokens}
            label="Telegram"
            disabled={!canTelegram}
            accessibilityLabel={`Открыть Telegram ${primaryPhone.value}`}
            onPress={() => onOpenTelegram(primaryPhone.digits)}
            leading={<TelegramBrandIcon size={16} disabled={!canTelegram} />}
          />
        ) : null}
        {primaryEmail ? (
          <PrimaryButton
            tokens={tokens}
            icon="email-outline"
            label="Написать в HUB"
            disabled={!canMail}
            accessibilityLabel={`Написать в HUB ${primaryEmail.value}`}
            onPress={() => onComposeEmail(primaryEmail.value)}
          />
        ) : null}
        {showChatAction ? (
          <PrimaryButton
            tokens={tokens}
            icon="forum-outline"
            label="Написать в чат"
            disabled={chatBusy}
            testID="address-book-chat-detail"
            accessibilityLabel={`Написать в чат ${item.full_name || ''}`}
            onPress={() => onOpenChat?.()}
          />
        ) : null}
      </View>

      <View style={styles.tags}>
        {item.department ? (
          <View style={[styles.tag, { backgroundColor: tokens.panelMuted, borderColor: tokens.borderSoft }]}>
            <AddressBookHighlight value={item.department} query={query} style={[styles.tagText, { color: tokens.textPrimary }]} />
          </View>
        ) : null}
        {item.department_location ? (
          <View style={[styles.tag, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
            <AddressBookHighlight value={item.department_location} query={query} style={[styles.tagText, { color: tokens.textPrimary }]} />
          </View>
        ) : null}
      </View>

      <PhoneActions
        tokens={tokens}
        phones={item.work_phones}
        label="Рабочие"
        query={query}
        onCopy={onCopy}
        onCall={onCall}
        onOpenTelegram={onOpenTelegram}
        onOpenMax={onOpenMax}
      />
      <PhoneActions
        tokens={tokens}
        phones={item.personal_phones}
        label="Личные"
        query={query}
        onCopy={onCopy}
        onCall={onCall}
        onOpenTelegram={onOpenTelegram}
        onOpenMax={onOpenMax}
      />
      <EmailActions
        tokens={tokens}
        emails={item.work_emails}
        label="Рабочая почта"
        query={query}
        onCopy={onCopy}
        onComposeEmail={onComposeEmail}
        onOpenExternalMail={onOpenExternalMail}
      />
      <EmailActions
        tokens={tokens}
        emails={item.personal_emails}
        label="Личная почта"
        query={query}
        onCopy={onCopy}
        onComposeEmail={onComposeEmail}
        onOpenExternalMail={onOpenExternalMail}
      />
    </View>
  );
}

function PhoneActions({
  tokens,
  phones,
  label,
  query,
  onCopy,
  onCall,
  onOpenTelegram,
  onOpenMax,
}: {
  tokens: FluentTokens;
  phones?: AddressBookPhone[] | null;
  label: string;
  query: string;
  onCopy: (value: string) => void;
  onCall: (telHref: string) => void;
  onOpenTelegram: (digits: string) => void;
  onOpenMax: (digits: string) => void;
}) {
  const items = Array.isArray(phones) ? phones : [];
  if (items.length === 0) return null;

  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: tokens.textSecondary }]}>{label}</Text>
      {items.map((phone, index) => {
        const value = normalizeText(phone?.value);
        const kind = normalizeText(phone?.kind);
        const digits = normalizeText(phone?.normalized) || normalizePhoneDigits(value);
        const telValue = digits ? `+${digits}` : value;
        const canOpenMessenger = isPhoneDeepLinkReady(digits);
        return (
          <View key={`${kind}-${value}-${index}`} style={styles.contactRow}>
            <View style={styles.contactText}>
              {kind ? (
                <AddressBookHighlight value={kind} query={query} style={[styles.kind, { color: tokens.textSecondary }]} />
              ) : null}
              <AddressBookHighlight value={value} query={query} style={[styles.value, { color: tokens.textPrimary }]} />
            </View>
            {telValue ? (
              <IconAction
                tokens={tokens}
                icon="phone"
                label={`Позвонить ${value}`}
                onPress={() => onCall(`tel:${telValue}`)}
              />
            ) : null}
            <IconAction
              tokens={tokens}
              label={`Открыть Telegram ${value}`}
              disabled={!canOpenMessenger}
              onPress={() => onOpenTelegram(digits)}
            >
              <TelegramBrandIcon size={20} disabled={!canOpenMessenger} />
            </IconAction>
            <IconAction
              tokens={tokens}
              label={`Открыть MAX ${value}`}
              disabled={!canOpenMessenger}
              onPress={() => onOpenMax(digits)}
            >
              <MaxBrandIcon size={20} disabled={!canOpenMessenger} />
            </IconAction>
            <IconAction
              tokens={tokens}
              icon="content-copy"
              label={`Скопировать ${value}`}
              onPress={() => onCopy(value)}
            />
          </View>
        );
      })}
    </View>
  );
}

function EmailActions({
  tokens,
  emails,
  label,
  query,
  onCopy,
  onComposeEmail,
  onOpenExternalMail,
}: {
  tokens: FluentTokens;
  emails?: AddressBookEmail[] | null;
  label: string;
  query: string;
  onCopy: (value: string) => void;
  onComposeEmail: (email: string) => void;
  onOpenExternalMail: (email: string) => void;
}) {
  const items = Array.isArray(emails) ? emails : [];
  if (items.length === 0) return null;

  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: tokens.textSecondary }]}>{label}</Text>
      {items.map((email, index) => {
        const value = normalizeText(email?.value);
        const kind = normalizeText(email?.kind);
        const canMail = isValidEmailRecipient(value);
        return (
          <View key={`${kind}-${value}-${index}`} style={styles.contactRow}>
            <View style={styles.contactText}>
              {kind ? (
                <AddressBookHighlight value={kind} query={query} style={[styles.kind, { color: tokens.textSecondary }]} />
              ) : null}
              <AddressBookHighlight value={value} query={query} style={[styles.value, { color: tokens.textPrimary }]} />
            </View>
            <IconAction
              tokens={tokens}
              icon="email-outline"
              label={`Написать в HUB ${value}`}
              disabled={!canMail}
              onPress={() => onComposeEmail(value)}
            />
            <IconAction
              tokens={tokens}
              icon="email-plus-outline"
              label={`Открыть внешнюю почту ${value}`}
              disabled={!canMail}
              onPress={() => onOpenExternalMail(value)}
            />
            <IconAction
              tokens={tokens}
              icon="content-copy"
              label={`Скопировать ${value}`}
              onPress={() => onCopy(value)}
            />
          </View>
        );
      })}
    </View>
  );
}

function PrimaryButton({
  tokens,
  icon,
  label,
  onPress,
  disabled,
  filled,
  accessibilityLabel,
  testID,
  leading,
}: {
  tokens: FluentTokens;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  filled?: boolean;
  accessibilityLabel: string;
  testID?: string;
  leading?: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.primaryButton,
        filled
          ? { backgroundColor: tokens.primary }
          : { backgroundColor: tokens.panelSolid, borderWidth: 1, borderColor: tokens.border },
        disabled ? styles.iconDisabled : null,
      ]}
    >
      {leading || (
        <MaterialCommunityIcons name={icon || 'circle-outline'} size={16} color={filled ? '#fff' : tokens.primary} />
      )}
      <Text style={[styles.primaryButtonLabel, { color: filled ? '#fff' : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function IconAction({
  tokens,
  icon,
  label,
  onPress,
  disabled,
  children,
}: {
  tokens: FluentTokens;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Pressable
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
  root: { gap: 12 },
  identity: { gap: 2 },
  title: { fontSize: 22, fontWeight: '800', lineHeight: 26 },
  meta: { fontSize: 13, lineHeight: 18 },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12, fontWeight: '800' },
  primaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryButtonLabel: { fontWeight: '800', fontSize: 13 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagText: { fontSize: 12, fontWeight: '700' },
  group: { gap: 8 },
  groupLabel: { fontSize: 12, fontWeight: '800' },
  contactRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  contactText: { flex: 1, minWidth: 0 },
  kind: { fontSize: 11 },
  value: { fontSize: 15, fontWeight: '700' },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDisabled: { opacity: 0.35 },
});
