import {
  applyPendingMailReadOverrides,
  clearPendingMailReadOverride,
  stagePendingMailReadOverride,
} from './nativeMailReadOverrides';

describe('nativeMailReadOverrides', () => {
  afterEach(() => clearPendingMailReadOverride('message-1', 'mailbox-1'));

  it('keeps an opened message read while a focused inbox receives stale server data', () => {
    stagePendingMailReadOverride('message-1', 'mailbox-1');

    expect(applyPendingMailReadOverrides([
      { id: 'message-1', mailbox_id: 'mailbox-1', is_read: false },
      { id: 'message-2', mailbox_id: 'mailbox-1', is_read: false },
    ], 'mailbox-1')).toEqual([
      { id: 'message-1', mailbox_id: 'mailbox-1', is_read: true },
      { id: 'message-2', mailbox_id: 'mailbox-1', is_read: false },
    ]);
  });
});
