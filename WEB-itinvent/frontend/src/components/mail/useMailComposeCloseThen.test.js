import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailComposeCloseThen from './useMailComposeCloseThen';

describe('useMailComposeCloseThen', () => {
  it('closes the session immediately when no host closer is registered', () => {
    const closeComposeSession = vi.fn();
    const afterClose = vi.fn();
    const { result } = renderHook(() => useMailComposeCloseThen({
      composeCloseRequestRef: { current: null },
      closeComposeSession,
    }));

    result.current(afterClose);

    expect(closeComposeSession).toHaveBeenCalledTimes(1);
    expect(afterClose).toHaveBeenCalledTimes(1);
  });

  it('delegates to the registered compose closer', () => {
    const closer = vi.fn();
    const closeComposeSession = vi.fn();
    const afterClose = vi.fn();
    const { result } = renderHook(() => useMailComposeCloseThen({
      composeCloseRequestRef: { current: closer },
      closeComposeSession,
    }));

    result.current(afterClose);

    expect(closer).toHaveBeenCalledWith({ afterClose });
    expect(closeComposeSession).not.toHaveBeenCalled();
    expect(afterClose).not.toHaveBeenCalled();
  });
});
