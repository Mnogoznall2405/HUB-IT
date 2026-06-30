import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHAT_SIDEBAR_SEARCH_COLLAPSE_THRESHOLD,
  useChatSidebarSearchCollapse,
} from './useChatSidebarSearchCollapse';

const flushAnimationFrame = () => new Promise((resolve) => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(resolve);
  });
});

describe('useChatSidebarSearchCollapse', () => {
  let scrollElement;

  beforeEach(() => {
    scrollElement = document.createElement('div');
    Object.defineProperty(scrollElement, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
    document.body.appendChild(scrollElement);
  });

  afterEach(() => {
    scrollElement.remove();
  });

  it('collapses search after scrolling past threshold', async () => {
    const { result } = renderHook(() => useChatSidebarSearchCollapse({
      enabled: true,
      reducedMotion: true,
      scrollElement,
      searchActive: false,
      searchFocused: false,
    }));

    expect(result.current.isSearchCollapsed).toBe(false);

    scrollElement.scrollTop = CHAT_SIDEBAR_SEARCH_COLLAPSE_THRESHOLD + 20;
    act(() => {
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    await act(async () => {
      await flushAnimationFrame();
    });

    expect(result.current.isSearchCollapsed).toBe(true);
    expect(result.current.collapseProgress).toBe(1);
  });

  it('keeps search expanded while search is active or focused', async () => {
    scrollElement.scrollTop = CHAT_SIDEBAR_SEARCH_COLLAPSE_THRESHOLD + 40;

    const { result, rerender } = renderHook(
      (props) => useChatSidebarSearchCollapse(props),
      {
        initialProps: {
          enabled: true,
          reducedMotion: true,
          scrollElement,
          searchActive: true,
          searchFocused: false,
        },
      },
    );

    act(() => {
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    await act(async () => {
      await flushAnimationFrame();
    });

    expect(result.current.isSearchCollapsed).toBe(false);

    rerender({
      enabled: true,
      reducedMotion: true,
      scrollElement,
      searchActive: false,
      searchFocused: true,
    });

    expect(result.current.isSearchCollapsed).toBe(false);
  });

  it('expandSearch scrolls list to top and expands search', async () => {
    scrollElement.scrollTop = 240;

    const { result } = renderHook(() => useChatSidebarSearchCollapse({
      enabled: true,
      reducedMotion: true,
      scrollElement,
    }));

    act(() => {
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    await act(async () => {
      await flushAnimationFrame();
    });

    expect(result.current.isSearchCollapsed).toBe(true);

    act(() => {
      result.current.expandSearch();
    });

    expect(scrollElement.scrollTop).toBe(0);
    expect(result.current.isSearchCollapsed).toBe(false);
    expect(result.current.collapseProgress).toBe(0);
  });
});
