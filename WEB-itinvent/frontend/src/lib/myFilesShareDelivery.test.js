import { describe, expect, it } from 'vitest';
import {
  buildMyFilesShareMailSubject,
  buildMyFilesShareMessage,
  formatAddressBookOptionLabel,
  listAddressBookPhones,
  pickAddressBookPhone,
} from './myFilesShareDelivery';

describe('myFilesShareDelivery', () => {
  it('builds a share message with file name and url', () => {
    const message = buildMyFilesShareMessage({
      fileName: 'report.pdf',
      url: 'https://hub.example/shared-files/token',
      expiresAt: '2026-06-13T10:00:00+00:00',
    });
    expect(message).toContain('report.pdf');
    expect(message).toContain('https://hub.example/shared-files/token');
    expect(message).toContain('Ссылка для скачивания:');
    expect(message).not.toContain('(');
    expect(message).not.toContain('«');
    expect(message).toContain('Ссылка действует до');
  });

  it('uses the same url in share message for every channel', () => {
    const url = 'https://hub.example/shared-files/stable-token';
    const message = buildMyFilesShareMessage({ fileName: 'a.zip', url });
    expect(message.split('\n').filter((line) => line.includes('https://'))).toEqual([url]);
  });

  it('builds mail subject from file name', () => {
    expect(buildMyFilesShareMailSubject('report.pdf')).toBe('Файл для вас: report.pdf');
  });

  it('lists phones and picks the first for telegram', () => {
    const item = {
      work_phones: [{ normalized: '79001234567', value: '+7 900 123-45-67', kind: 'Мобильный' }],
      personal_phones: [{ normalized: '79007654321', value: '+7 900 765-43-21', kind: 'Личный' }],
    };
    const phones = listAddressBookPhones(item);
    expect(phones).toHaveLength(2);
    expect(pickAddressBookPhone(item)).toBe('79001234567');
  });

  it('formats address book option label with department', () => {
    expect(formatAddressBookOptionLabel({
      full_name: 'Иванов Иван',
      department: 'ИТ',
    })).toBe('Иванов Иван · ИТ');
  });
});
