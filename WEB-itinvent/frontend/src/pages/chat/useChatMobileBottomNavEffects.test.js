import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import useChatMobileBottomNavEffects from './useChatMobileBottomNavEffects';

const buildArgs = (overrides = {}) => ({
  isMobile: true,
  resolvedMobileView: 'inbox',
  setMobileBottomNavHidden: vi.fn(),
  ...overrides,
});

describe('useChatMobileBottomNavEffects', () => {
  it('hides the bottom nav whenever the thread view is resolved', () => {
    const setMobileBottomNavHidden = vi.fn();

    renderHook(() => useChatMobileBottomNavEffects(buildArgs({
      resolvedMobileView: 'thread',
      setMobileBottomNavHidden,
    })));

    expect(setMobileBottomNavHidden).toHaveBeenCalledWith(true);
    expect(setMobileBottomNavHidden).not.toHaveBeenCalledWith(false);
  });

  it('restores the bottom nav when leaving the thread view', () => {
    const setMobileBottomNavHidden = vi.fn();

    const { rerender } = renderHook(
      (props) => useChatMobileBottomNavEffects(props),
      {
        initialProps: buildArgs({
          resolvedMobileView: 'thread',
          setMobileBottomNavHidden,
        }),
      },
    );

    rerender(buildArgs({
      resolvedMobileView: 'inbox',
      setMobileBottomNavHidden,
    }));

    expect(setMobileBottomNavHidden).toHaveBeenLastCalledWith(false);
  });

  it('keeps the bottom nav visible on desktop even with a resolved thread', () => {
    const setMobileBottomNavHidden = vi.fn();

    renderHook(() => useChatMobileBottomNavEffects(buildArgs({
      isMobile: false,
      resolvedMobileView: 'thread',
      setMobileBottomNavHidden,
    })));

    expect(setMobileBottomNavHidden).toHaveBeenCalledWith(false);
  });
});
