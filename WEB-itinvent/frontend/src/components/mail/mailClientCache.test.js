import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MAIL_CLIENT_CACHE_PREFIXES,
  invalidateMailClientCacheForScope,
} from './mailClientCache';

describe('invalidateMailClientCacheForScope', () => {
  it('invalidates the default mail prefixes and the recent-cache scope', () => {
    const invalidateByPrefix = vi.fn();
    const clearRecentCache = vi.fn();

    invalidateMailClientCacheForScope('mailbox-1', undefined, {
      invalidateByPrefix,
      clearRecentCache,
    });

    expect(invalidateByPrefix.mock.calls).toEqual(
      DEFAULT_MAIL_CLIENT_CACHE_PREFIXES.map((prefix) => ['mail', 'mailbox-1', prefix]),
    );
    expect(clearRecentCache).toHaveBeenCalledWith('mailbox-1');
  });

  it('accepts a custom prefix list', () => {
    const invalidateByPrefix = vi.fn();
    const clearRecentCache = vi.fn();

    invalidateMailClientCacheForScope('mailbox-1', ['list', 'bootstrap'], {
      invalidateByPrefix,
      clearRecentCache,
    });

    expect(invalidateByPrefix).toHaveBeenNthCalledWith(1, 'mail', 'mailbox-1', 'list');
    expect(invalidateByPrefix).toHaveBeenNthCalledWith(2, 'mail', 'mailbox-1', 'bootstrap');
    expect(clearRecentCache).toHaveBeenCalledWith('mailbox-1');
  });
});
