import { describe, expect, it } from 'vitest';
import { withMailboxQuery } from './mailMailboxQuery';

describe('withMailboxQuery', () => {
  it('copies mailboxId into mailbox_id and drops the camelCase key', () => {
    expect(withMailboxQuery({ folder: 'inbox', mailboxId: 'mb-1' })).toEqual({
      folder: 'inbox',
      mailbox_id: 'mb-1',
    });
  });

  it('uses the explicit mailbox id over params', () => {
    expect(withMailboxQuery({ mailbox_id: 'old' }, 'next')).toEqual({ mailbox_id: 'next' });
  });
});
