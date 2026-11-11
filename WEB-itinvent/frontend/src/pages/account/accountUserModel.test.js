import { describe, expect, it } from 'vitest';

import {
  buildDefaultExchangeLoginPreview,
  createEmptyUserDraft,
  createUserDraftFromItem,
  matchesUserSearch,
  mergeTaskDelegatesIntoUsers,
  myFilesQuotaBytesToGb,
  myFilesQuotaGbToBytes,
  normalizePermissions,
  normalizeTaskDelegateLinks,
  summarizePermissions,
} from './accountUserModel';

describe('accountUserModel', () => {
  it('normalizes permission lists with deduplication', () => {
    expect(normalizePermissions(['tasks.view', 'tasks.view', '', 'settings.users'])).toEqual([
      'tasks.view',
      'settings.users',
    ]);
  });

  it('summarizes custom permissions count', () => {
    expect(summarizePermissions({
      use_custom_permissions: true,
      custom_permissions: ['tasks.view', 'settings.users'],
    })).toBe('2 прав');
    expect(summarizePermissions({ use_custom_permissions: false })).toBe('По роли');
  });

  it('creates empty user draft with role defaults', () => {
    const draft = createEmptyUserDraft();
    expect(draft.username).toBe('');
    expect(draft.role).toBe('viewer');
    expect(Array.isArray(draft.custom_permissions)).toBe(true);
  });

  it('normalizes task delegate links', () => {
    expect(normalizeTaskDelegateLinks([
      { delegate_user_id: 2 },
      { delegate_user_id: '3', role_type: 'deputy' },
    ])).toEqual([
      expect.objectContaining({ delegate_user_id: '2', role_type: 'assistant', is_active: true }),
      expect.objectContaining({ delegate_user_id: '3', role_type: 'deputy', is_active: true }),
    ]);
  });

  it('builds default Exchange login preview from username variants', () => {
    expect(buildDefaultExchangeLoginPreview('')).toBe('username@zsgp.corp');
    expect(buildDefaultExchangeLoginPreview('Ivanov')).toBe('ivanov@zsgp.corp');
    expect(buildDefaultExchangeLoginPreview('CORP\\Petrov')).toBe('petrov@zsgp.corp');
    expect(buildDefaultExchangeLoginPreview('sidorov@zsgp.corp')).toBe('sidorov@zsgp.corp');
  });

  it('matches user search across common profile fields', () => {
    const user = {
      username: 'jdoe',
      full_name: 'John Doe',
      department: 'IT',
      job_title: 'Engineer',
      email: 'john@example.com',
      mailbox_email: 'jdoe@zsgp.corp',
      telegram_id: '12345',
    };
    expect(matchesUserSearch(user, '')).toBe(true);
    expect(matchesUserSearch(user, 'john')).toBe(true);
    expect(matchesUserSearch(user, 'IT')).toBe(true);
    expect(matchesUserSearch(user, '12345')).toBe(true);
    expect(matchesUserSearch(user, 'missing')).toBe(false);
  });

  it('converts My Files quota between bytes and GB with a 400 GB cap', () => {
    expect(myFilesQuotaBytesToGb(100 * (1024 ** 3))).toBe('100');
    expect(myFilesQuotaBytesToGb(Math.round(1.5 * (1024 ** 3)))).toBe('1.5');
    expect(myFilesQuotaBytesToGb(null)).toBe('');
    expect(myFilesQuotaBytesToGb(0)).toBe('');

    expect(myFilesQuotaGbToBytes('100')).toBe(100 * (1024 ** 3));
    expect(myFilesQuotaGbToBytes('')).toBeNull();
    expect(myFilesQuotaGbToBytes(0)).toBeUndefined();
    expect(myFilesQuotaGbToBytes(401)).toBeUndefined();
    expect(myFilesQuotaGbToBytes('abc')).toBeUndefined();
  });

  it('maps my_files_quota_bytes into the user draft', () => {
    const draft = createUserDraftFromItem({
      id: 5,
      username: 'quota-user',
      my_files_quota_bytes: 200 * (1024 ** 3),
    });
    expect(draft.my_files_quota_gb).toBe('200');
    expect(createUserDraftFromItem({ id: 6, username: 'default-user' }).my_files_quota_gb).toBe('');
  });

  it('merges task delegate links from bulk payload into users', () => {
    const users = [
      { id: 1, username: 'owner' },
      { id: 2, username: 'other' },
    ];
    const bulkPayload = {
      items: [
        {
          owner_user_id: 1,
          task_delegate_links: [{ delegate_user_id: 3, role_type: 'deputy' }],
        },
      ],
    };

    expect(mergeTaskDelegatesIntoUsers(users, bulkPayload)).toEqual([
      expect.objectContaining({
        id: 1,
        task_delegate_links: [
          expect.objectContaining({ delegate_user_id: '3', role_type: 'deputy' }),
        ],
      }),
      expect.objectContaining({ id: 2, task_delegate_links: [] }),
    ]);
  });
});
