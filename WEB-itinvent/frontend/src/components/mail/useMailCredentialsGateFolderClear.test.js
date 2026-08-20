import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailCredentialsGateFolderClear from './useMailCredentialsGateFolderClear';

describe('useMailCredentialsGateFolderClear', () => {
  it('clears folders only after config resolved into the credentials gate', () => {
    const setFolderSummary = vi.fn();
    const setFolderTree = vi.fn();
    renderHook(() => useMailCredentialsGateFolderClear({
      mailAccessReady: false,
      mailConfigLoading: false,
      mailRequiresPassword: true,
      mailRequiresRelogin: false,
      setFolderSummary,
      setFolderTree,
    }));
    expect(setFolderSummary).toHaveBeenCalledWith({});
    expect(setFolderTree).toHaveBeenCalledWith([]);
  });

  it('keeps recent folders while bootstrap is still loading', () => {
    const setFolderSummary = vi.fn();
    renderHook(() => useMailCredentialsGateFolderClear({
      mailAccessReady: false,
      mailConfigLoading: true,
      mailRequiresPassword: true,
      mailRequiresRelogin: false,
      setFolderSummary,
      setFolderTree: vi.fn(),
    }));
    expect(setFolderSummary).not.toHaveBeenCalled();
  });
});
