import {
  absenceChipColor,
  buildWorkplaceLabel,
  collectAddressBookChatLookup,
  formatAge,
  formatAbsenceLabel,
  formatDate,
  isValidEmailRecipient,
  pickPrimaryEmail,
  pickPrimaryPhone,
  pickQuickActionPhone,
  splitHighlightParts,
} from './addressBookFormat';
import { buildTelegramDeepLinks, isPhoneDeepLinkReady } from './messengerLinks';

describe('addressBookFormat', () => {
  it('formatAge uses the correct Russian plural form', () => {
    expect(formatAge(21)).toBe('21 год');
    expect(formatAge(32)).toBe('32 года');
    expect(formatAge(45)).toBe('45 лет');
    expect(formatAge(11)).toBe('11 лет');
    expect(formatAge(null)).toBe('');
  });

  it('formatDate renders a ZUP date without timezone shifts', () => {
    expect(formatDate('2021-05-17')).toBe('17.05.2021');
    expect(formatDate('2021-02-30')).toBe('');
    expect(formatDate(null)).toBe('');
  });

  it('formatAbsenceLabel shows return date from ZUP', () => {
    expect(formatAbsenceLabel({
      kind: 'vacation',
      label: 'Отпуск основной',
      starts_on: '2026-07-20',
      returns_on: '2026-08-03',
    })).toBe('Отпуск основной · выйдет 03.08');
    expect(absenceChipColor({ kind: 'sick' })).toBe('error');
    expect(absenceChipColor({ kind: 'vacation' })).toBe('warning');
  });

  it('pickQuickActionPhone prefers personal mobile over work phone', () => {
    const item = {
      work_phones: [{ kind: 'Рабочий телефон', value: '83452384202', normalized: '73452384202' }],
      personal_phones: [{ kind: 'Мобильный телефон', value: '89312250556', normalized: '79312250556' }],
    };

    const quick = pickQuickActionPhone(item);
    expect(quick?.value).toBe('89312250556');
    expect(quick?.digits).toBe('79312250556');
    expect(quick?.telHref).toBe('tel:+79312250556');
  });

  it('pickPrimaryPhone prefers work phone over personal mobile', () => {
    const item = {
      work_phones: [{ kind: 'Рабочий телефон', value: '83452384202', normalized: '73452384202' }],
      personal_phones: [{ kind: 'Мобильный телефон', value: '89312250556', normalized: '79312250556' }],
    };

    const primary = pickPrimaryPhone(item);
    expect(primary?.value).toBe('83452384202');
    expect(primary?.digits).toBe('73452384202');
    expect(primary?.telHref).toBe('tel:+73452384202');
  });

  it('pickPrimaryPhone prefers work mobile when available', () => {
    const item = {
      work_phones: [
        { kind: 'Рабочий телефон', value: '83450000000', normalized: '73450000000' },
        { kind: 'Мобильный рабочий', value: '89001112233', normalized: '79001112233' },
      ],
      personal_phones: [{ kind: 'Мобильный телефон', value: '89003334455', normalized: '79003334455' }],
    };

    expect(pickPrimaryPhone(item)?.value).toBe('89001112233');
  });

  it('buildWorkplaceLabel combines office address, room and workplace like the web card', () => {
    expect(buildWorkplaceLabel({
      office_address: 'ул. Ленина, 1',
      office_room: '301',
      workplace_number: '12',
    })).toBe('ул. Ленина, 1 · каб. 301 · рм 12');
    expect(buildWorkplaceLabel({ office_address: 'База', office_room: '0', workplace_number: '0' })).toBe('База');
    expect(buildWorkplaceLabel({ office_room: '5' })).toBe('каб. 5');
    expect(buildWorkplaceLabel(null)).toBe('');
    expect(buildWorkplaceLabel({})).toBe('');
  });

  it('collectAddressBookChatLookup prefers work emails and deduplicates values', () => {
    const item = {
      full_name: 'Ivanov Ivan',
      work_emails: [{ value: 'ivanov@zsgp.ru' }, { value: 'IVANOV@ZSGP.RU' }],
      personal_emails: [{ value: 'ivanov@gmail.com' }],
    };

    expect(collectAddressBookChatLookup(item)).toEqual({
      fullName: 'Ivanov Ivan',
      emails: ['ivanov@zsgp.ru', 'ivanov@gmail.com'],
    });
  });

  it('pickPrimaryEmail returns first work email', () => {
    const item = {
      work_emails: [
        { kind: 'Корпоративный E-mail', value: 'ivanov@zsgp.ru' },
        { kind: 'Дополнительный', value: 'ivanov2@zsgp.ru' },
      ],
    };

    expect(pickPrimaryEmail(item)).toEqual({
      value: 'ivanov@zsgp.ru',
      email: item.work_emails[0],
    });
  });

  it('validates email recipients and splits highlight parts', () => {
    expect(isValidEmailRecipient('ivanov@zsgp.ru')).toBe(true);
    expect(isValidEmailRecipient('not-an-address')).toBe(false);
    expect(splitHighlightParts('Ivanov', 'iva')).toEqual([
      { text: 'Iva', match: true },
      { text: 'nov', match: false },
    ]);
  });

  it('keeps highlight offsets aligned when toLowerCase changes char length', () => {
    // 'İ' lowercases to 'i̇' (two UTF-16 units) — offsets must still slice
    // the original string exactly at its own characters.
    expect(splitHighlightParts('İstanbul Ofis', 'İst')).toEqual([
      { text: 'İst', match: true },
      { text: 'anbul Ofis', match: false },
    ]);
    expect(splitHighlightParts('İstanbul', 'anbul')).toEqual([
      { text: 'İst', match: false },
      { text: 'anbul', match: true },
    ]);
  });
});

describe('messengerLinks', () => {
  it('builds Telegram deep links for 11-digit numbers', () => {
    expect(isPhoneDeepLinkReady('79312250556')).toBe(true);
    expect(buildTelegramDeepLinks('89312250556')).toEqual({
      appLink: 'tg://resolve?phone=79312250556',
      webLink: 'https://t.me/+79312250556',
    });
    expect(buildTelegramDeepLinks('123')).toBeNull();
  });
});
