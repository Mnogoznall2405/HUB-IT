import { describe, expect, it } from 'vitest';

import {
  MAIL_MOBILE_HISTORY_DRAWER_KEY,
  MAIL_MOBILE_HISTORY_FLAG,
  MAIL_MOBILE_HISTORY_MESSAGE_KEY,
  MAIL_MOBILE_HISTORY_MODE_KEY,
  MAIL_MOBILE_HISTORY_VIEW_KEY,
  buildMailMobileHistoryState,
  getMailMobileHistoryKey,
  readMailMobileHistoryState,
} from './mailMobileHistory';

describe('mailMobileHistory', () => {
  it('builds stable keys for mobile list and preview states', () => {
    expect(getMailMobileHistoryKey({ view: 'list', drawerOpen: true })).toBe('list:open:none:messages');
    expect(getMailMobileHistoryKey({ view: 'preview', selectedId: 'm1', selectionMode: 'conversations' }))
      .toBe('preview:closed:m1:conversations');
  });

  it('reads only mail-owned browser history states', () => {
    expect(readMailMobileHistoryState({})).toBeNull();
    expect(readMailMobileHistoryState({
      [MAIL_MOBILE_HISTORY_FLAG]: true,
      [MAIL_MOBILE_HISTORY_VIEW_KEY]: 'preview',
      [MAIL_MOBILE_HISTORY_MESSAGE_KEY]: 'm1',
      [MAIL_MOBILE_HISTORY_MODE_KEY]: 'conversations',
    })).toEqual({
      view: 'preview',
      drawerOpen: false,
      selectedId: 'm1',
      selectionMode: 'conversations',
    });
  });

  it('builds browser history state without dropping unrelated router state', () => {
    const { nextHistoryState, key } = buildMailMobileHistoryState(
      { existing: 'router-state' },
      { view: 'list', drawerOpen: true, selectedId: 'ignored', selectionMode: 'messages' },
    );

    expect(nextHistoryState).toMatchObject({
      existing: 'router-state',
      [MAIL_MOBILE_HISTORY_FLAG]: true,
      [MAIL_MOBILE_HISTORY_VIEW_KEY]: 'list',
      [MAIL_MOBILE_HISTORY_DRAWER_KEY]: true,
      [MAIL_MOBILE_HISTORY_MESSAGE_KEY]: '',
      [MAIL_MOBILE_HISTORY_MODE_KEY]: 'messages',
    });
    expect(key).toBe('list:open:none:messages');
  });

  it('normalizes preview and list state before it reaches browser history', () => {
    expect(buildMailMobileHistoryState(
      { existing: 'router-state' },
      { view: 'preview', drawerOpen: true, selectedId: '  msg-2  ', selectionMode: 'conversations' },
    )).toEqual({
      nextHistoryState: expect.objectContaining({
        existing: 'router-state',
        [MAIL_MOBILE_HISTORY_VIEW_KEY]: 'preview',
        [MAIL_MOBILE_HISTORY_DRAWER_KEY]: false,
        [MAIL_MOBILE_HISTORY_MESSAGE_KEY]: 'msg-2',
        [MAIL_MOBILE_HISTORY_MODE_KEY]: 'conversations',
      }),
      key: 'preview:closed:msg-2:conversations',
    });

    expect(readMailMobileHistoryState({
      [MAIL_MOBILE_HISTORY_FLAG]: true,
      [MAIL_MOBILE_HISTORY_VIEW_KEY]: 'list',
      [MAIL_MOBILE_HISTORY_DRAWER_KEY]: true,
      [MAIL_MOBILE_HISTORY_MESSAGE_KEY]: 'stale-preview-id',
      [MAIL_MOBILE_HISTORY_MODE_KEY]: 'unknown',
    })).toEqual({
      view: 'list',
      drawerOpen: true,
      selectedId: '',
      selectionMode: 'messages',
    });
  });
});
