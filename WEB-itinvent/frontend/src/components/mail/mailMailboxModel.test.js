import { describe, expect, it } from 'vitest';

import {
  buildFallbackMailboxEntry,
  getMailboxEntryId,
  MAIL_SELECTED_MAILBOX_STORAGE_KEY,
  mergeMailboxEntries,
  normalizeMailboxId,
  normalizeUnreadCountState,
  readStoredSelectedMailboxId,
  resolveComposeMailboxId,
  resolveItemMailboxId,
  withMailboxParams,
  withMailboxPayload,
  writeStoredSelectedMailboxId,
} from './mailMailboxModel';

describe('mailMailboxModel', () => {
  it('normalizes mailbox identifiers using id before mailbox_id', () => {
    expect(normalizeMailboxId(' mailbox-1 ')).toBe('mailbox-1');
    expect(normalizeMailboxId(null)).toBe('');
    expect(getMailboxEntryId({ id: ' primary ', mailbox_id: 'secondary' })).toBe('primary');
    expect(getMailboxEntryId({ mailbox_id: ' mailbox-2 ' })).toBe('mailbox-2');
    expect(getMailboxEntryId(null)).toBe('');
  });

  it('normalizes unread count state to the supported domain values', () => {
    expect(normalizeUnreadCountState(' Fresh ')).toBe('fresh');
    expect(normalizeUnreadCountState('STALE')).toBe('stale');
    expect(normalizeUnreadCountState('ready')).toBe('deferred');
    expect(normalizeUnreadCountState('')).toBe('deferred');
  });

  it('stores and reads the last selected mailbox id with safe normalization', () => {
    const storage = new Map();
    const storageAdapter = {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };

    writeStoredSelectedMailboxId(' shared ', { storage: storageAdapter });
    expect(storage.get(MAIL_SELECTED_MAILBOX_STORAGE_KEY)).toBe('shared');
    expect(readStoredSelectedMailboxId({ storage: storageAdapter })).toBe('shared');

    writeStoredSelectedMailboxId('', { storage: storageAdapter });
    expect(storage.has(MAIL_SELECTED_MAILBOX_STORAGE_KEY)).toBe(false);
    expect(readStoredSelectedMailboxId({ storage: storageAdapter })).toBe('');
  });

  it('builds selected fallback mailbox entries with display, login, and auth fields', () => {
    expect(buildFallbackMailboxEntry({
      mailbox_id: ' selected-1 ',
      mailbox_email: 'box@example.com',
      mailbox_login: 'box-login',
      effective_mailbox_login: 'effective-login',
      mail_auth_mode: 'oauth',
      unread_count: '4',
      unread_count_state: 'stale',
      last_selected_at: '2026-05-03T10:00:00Z',
      is_primary: 1,
    })).toEqual({
      id: 'selected-1',
      label: 'box@example.com',
      mailbox_email: 'box@example.com',
      mailbox_login: 'box-login',
      effective_mailbox_login: 'effective-login',
      auth_mode: 'oauth',
      is_primary: true,
      is_active: true,
      unread_count: 4,
      unread_count_state: 'stale',
      last_selected_at: '2026-05-03T10:00:00Z',
      selected: true,
    });

    expect(buildFallbackMailboxEntry({ id: 'selected-2', effective_mailbox_login: 'login@example.com' }).label)
      .toBe('login@example.com');
    expect(buildFallbackMailboxEntry({ id: 'selected-3' }).label).toBe('Почтовый ящик');
    expect(buildFallbackMailboxEntry({})).toBeNull();
  });

  it('merges entries, removes duplicate ids, and normalizes active and primary flags', () => {
    expect(mergeMailboxEntries([
      { id: ' a ', label: 'A', unread_count: 2, unread_count_state: 'fresh', is_primary: true },
      { mailbox_id: 'a', label: 'Duplicate A', unread_count: 5 },
      { mailbox_id: 'b', label: 'B', is_active: false },
      { id: '   ', label: 'Blank' },
    ])).toEqual([
      {
        id: 'a',
        label: 'A',
        unread_count: 2,
        unread_count_state: 'fresh',
        is_active: true,
        is_primary: true,
      },
      {
        mailbox_id: 'b',
        id: 'b',
        label: 'B',
        unread_count: 0,
        unread_count_state: 'deferred',
        is_active: false,
        is_primary: false,
      },
    ]);
  });

  it('preserves fresh unread count and state from existing entries when next data is not fresh', () => {
    expect(mergeMailboxEntries(
      [{ id: 'mailbox-1', label: 'Next', unread_count: 1, unread_count_state: 'stale' }],
      null,
      [{ id: 'mailbox-1', label: 'Existing', unread_count: 7, unread_count_state: 'fresh' }],
    )).toEqual([
      {
        id: 'mailbox-1',
        label: 'Next',
        unread_count: 7,
        unread_count_state: 'fresh',
        is_active: true,
        is_primary: false,
      },
    ]);

    expect(mergeMailboxEntries(
      [{ id: 'mailbox-1', unread_count: 3, unread_count_state: 'fresh' }],
      null,
      [{ id: 'mailbox-1', unread_count: 7, unread_count_state: 'fresh' }],
    )[0]).toMatchObject({ unread_count: 3, unread_count_state: 'fresh' });
  });

  it('prepends selected mailbox fallback and preserves its fresh unread state from existing entries', () => {
    expect(mergeMailboxEntries(
      [{ id: 'other', label: 'Other' }],
      {
        mailbox_id: 'selected',
        label: 'Selected',
        mailbox_email: 'selected@example.com',
        mailbox_login: 'login',
        auth_mode: 'stored_credentials',
        unread_count: 0,
        unread_count_state: 'deferred',
      },
      [{ id: 'selected', unread_count: 9, unread_count_state: 'fresh' }],
    )).toEqual([
      {
        id: 'selected',
        label: 'Selected',
        mailbox_email: 'selected@example.com',
        mailbox_login: 'login',
        effective_mailbox_login: '',
        auth_mode: 'stored_credentials',
        is_primary: false,
        is_active: true,
        unread_count: 9,
        unread_count_state: 'fresh',
        last_selected_at: null,
        selected: true,
      },
      {
        id: 'other',
        label: 'Other',
        unread_count: 0,
        unread_count_state: 'deferred',
        is_active: true,
        is_primary: false,
      },
    ]);
  });

  it('does not add a selected fallback when that mailbox is already in entries', () => {
    expect(mergeMailboxEntries(
      [{ id: 'selected', label: 'From list', unread_count: 1, unread_count_state: 'fresh' }],
      { mailbox_id: 'selected', label: 'Fallback' },
    )).toEqual([
      {
        id: 'selected',
        label: 'From list',
        unread_count: 1,
        unread_count_state: 'fresh',
        is_active: true,
        is_primary: false,
      },
    ]);
  });

  it('adds active mailbox scope to params and payload only when available', () => {
    expect(withMailboxParams(' mb-1 ', { folder: 'inbox' })).toEqual({ folder: 'inbox', mailbox_id: 'mb-1' });
    expect(withMailboxParams('', { folder: 'inbox' })).toEqual({ folder: 'inbox' });
    expect(withMailboxPayload('mb-2', { target_folder: 'archive' })).toEqual({ target_folder: 'archive', mailbox_id: 'mb-2' });
    expect(withMailboxPayload('', { target_folder: 'archive' })).toEqual({ target_folder: 'archive' });
  });

  it('resolves item and compose mailbox ids by explicit candidate, active mailbox, and fallback options', () => {
    expect(resolveItemMailboxId({
      item: { compose_context: { mailbox_id: 'compose-mb' } },
      activeMailboxId: 'active-mb',
    })).toBe('compose-mb');
    expect(resolveItemMailboxId({
      item: { draft_context: { mailbox_id: 'draft-mb' } },
      activeMailboxId: 'active-mb',
    })).toBe('draft-mb');
    expect(resolveItemMailboxId({ item: {}, activeMailboxId: 'active-mb' })).toBe('active-mb');

    expect(resolveComposeMailboxId({
      candidate: ' candidate-mb ',
      activeMailboxId: 'active-mb',
      composeFromOptions: [{ id: 'option-mb' }],
    })).toBe('candidate-mb');
    expect(resolveComposeMailboxId({
      activeMailboxId: 'active-mb',
      composeFromOptions: [{ id: 'option-mb' }],
    })).toBe('active-mb');
    expect(resolveComposeMailboxId({
      composeFromOptions: [{ mailbox_id: 'option-mb' }],
    })).toBe('option-mb');
  });
});
