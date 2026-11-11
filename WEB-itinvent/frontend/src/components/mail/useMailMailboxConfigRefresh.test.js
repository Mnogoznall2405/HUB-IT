import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailMailboxConfigRefresh from './useMailMailboxConfigRefresh';

describe('useMailMailboxConfigRefresh', () => {
  it('loads config and selects the resolved mailbox', async () => {
    const data = { id: 'mb-2', mailbox_email: 'a@b.c' };
    const deps = {
      mailAPI: { getMyConfig: vi.fn(async () => data) },
      activeMailboxId: 'mb-1',
      mergeMailboxEntries: vi.fn((prev, next) => [...prev, next]),
      getMailboxEntryId: vi.fn(() => 'mb-2'),
      getMailErrorDetail: vi.fn(),
      setMailConfigLoading: vi.fn(),
      setMailboxInfo: vi.fn(),
      setMailboxes: vi.fn((updater) => updater([])),
      setSelectedMailboxId: vi.fn(),
      setError: vi.fn(),
    };
    const { result } = renderHook(() => useMailMailboxConfigRefresh(deps));

    await expect(result.current()).resolves.toEqual(data);

    expect(deps.mailAPI.getMyConfig).toHaveBeenCalledWith({ mailbox_id: 'mb-1' });
    expect(deps.setMailboxInfo).toHaveBeenCalledWith(data);
    expect(deps.setSelectedMailboxId).toHaveBeenCalledWith('mb-2');
    expect(deps.setMailConfigLoading).toHaveBeenNthCalledWith(1, true);
    expect(deps.setMailConfigLoading).toHaveBeenLastCalledWith(false);
    expect(deps.setError).not.toHaveBeenCalled();
  });

  it('clears mailbox info when config fails', async () => {
    const error = new Error('down');
    const deps = {
      mailAPI: {
        getMyConfig: vi.fn(async () => {
          throw error;
        }),
      },
      activeMailboxId: '',
      mergeMailboxEntries: vi.fn(),
      getMailboxEntryId: vi.fn(),
      getMailErrorDetail: vi.fn(() => 'Не удалось загрузить почтовую конфигурацию.'),
      setMailConfigLoading: vi.fn(),
      setMailboxInfo: vi.fn(),
      setMailboxes: vi.fn(),
      setSelectedMailboxId: vi.fn(),
      setError: vi.fn(),
    };
    const { result } = renderHook(() => useMailMailboxConfigRefresh(deps));

    await expect(result.current()).resolves.toBeNull();

    expect(deps.mailAPI.getMyConfig).toHaveBeenCalledWith({ mailbox_id: undefined });
    expect(deps.setMailboxInfo).toHaveBeenCalledWith(null);
    expect(deps.setError).toHaveBeenCalledWith('Не удалось загрузить почтовую конфигурацию.');
    expect(deps.setSelectedMailboxId).not.toHaveBeenCalled();
  });
});
