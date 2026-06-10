import { describe, expect, it } from 'vitest';
import {
  collectAddressBookChatLookup,
  pickPrimaryEmail,
  pickPrimaryPhone,
  pickQuickActionPhone,
} from './addressBookUtils';

describe('addressBookUtils', () => {
  it('pickQuickActionPhone prefers personal mobile over work phone', () => {
    const item = {
      work_phones: [{ kind: 'Рабочий телефон', value: '83452384202', normalized: '73452384202' }],
      personal_phones: [{ kind: 'Мобильный телефон', value: '89312250556', normalized: '79312250556' }],
    };

    const quick = pickQuickActionPhone(item);
    expect(quick.value).toBe('89312250556');
    expect(quick.digits).toBe('79312250556');
    expect(quick.telHref).toBe('tel:+79312250556');
  });

  it('pickPrimaryPhone prefers work phone over personal mobile', () => {
    const item = {
      work_phones: [{ kind: 'Рабочий телефон', value: '83452384202', normalized: '73452384202' }],
      personal_phones: [{ kind: 'Мобильный телефон', value: '89312250556', normalized: '79312250556' }],
    };

    const primary = pickPrimaryPhone(item);
    expect(primary.value).toBe('83452384202');
    expect(primary.digits).toBe('73452384202');
    expect(primary.telHref).toBe('tel:+73452384202');
  });

  it('pickPrimaryPhone prefers work mobile when available', () => {
    const item = {
      work_phones: [
        { kind: 'Рабочий телефон', value: '83450000000', normalized: '73450000000' },
        { kind: 'Мобильный рабочий', value: '89001112233', normalized: '79001112233' },
      ],
      personal_phones: [{ kind: 'Мобильный телефон', value: '89003334455', normalized: '79003334455' }],
    };

    const primary = pickPrimaryPhone(item);
    expect(primary.value).toBe('89001112233');
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
});
