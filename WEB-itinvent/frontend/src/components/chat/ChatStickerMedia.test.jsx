import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatStickerMedia from './ChatStickerMedia';

const loadAnimationMock = vi.hoisted(() => vi.fn());

vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: { loadAnimation: loadAnimationMock },
}));

const theme = createTheme();

class MockIntersectionObserver {
  static instances = [];

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    MockIntersectionObserver.instances.push(this);
  }

  observe = (target) => this.targets.add(target);

  unobserve = (target) => this.targets.delete(target);

  disconnect = () => this.targets.clear();

  trigger(targets, isIntersecting) {
    const entries = targets.map((target) => ({ target, isIntersecting }));
    this.callback(entries, this);
  }
}

const renderMedia = (node) => render(
  <ThemeProvider theme={theme}>{node}</ThemeProvider>,
);

describe('ChatStickerMedia lifecycle', () => {
  let originalIntersectionObserver;
  let originalFetch;
  let playSpy;
  let pauseSpy;
  let loadSpy;

  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    originalIntersectionObserver = window.IntersectionObserver;
    originalFetch = globalThis.fetch;
    window.IntersectionObserver = MockIntersectionObserver;
    globalThis.IntersectionObserver = MockIntersectionObserver;
    playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue();
    pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    loadSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    loadAnimationMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    if (originalIntersectionObserver) {
      window.IntersectionObserver = originalIntersectionObserver;
      globalThis.IntersectionObserver = originalIntersectionObserver;
    } else {
      delete window.IntersectionObserver;
      delete globalThis.IntersectionObserver;
    }
    globalThis.fetch = originalFetch;
    playSpy.mockRestore();
    pauseSpy.mockRestore();
    loadSpy.mockRestore();
    vi.useRealTimers();
  });

  it('keeps forty offscreen animated stickers unloaded behind one shared observer', () => {
    const { container } = renderMedia(
      <>
        {Array.from({ length: 40 }, (_, index) => (
          <ChatStickerMedia
            key={index}
            src={`/stickers/${index}.webm`}
            mimeType="video/webm"
            autoPlay
            forceAutoPlay
          />
        ))}
      </>,
    );

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    expect(MockIntersectionObserver.instances[0].options).toMatchObject({
      rootMargin: '240px 0px',
      threshold: 0.01,
    });
    expect(container.querySelectorAll('video')).toHaveLength(0);

    const roots = screen.getAllByTestId('chat-sticker-media');
    act(() => MockIntersectionObserver.instances[0].trigger(roots.slice(0, 2), true));

    expect(container.querySelectorAll('video')).toHaveLength(2);
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it('pauses immediately and unloads a video four seconds after it leaves the preload zone', () => {
    vi.useFakeTimers();
    const { container } = renderMedia(
      <ChatStickerMedia src="/stickers/animated.webm" mimeType="video/webm" autoPlay forceAutoPlay />,
    );
    const root = screen.getByTestId('chat-sticker-media');
    const observer = MockIntersectionObserver.instances[0];

    act(() => observer.trigger([root], true));
    expect(container.querySelector('video')).toBeTruthy();

    act(() => observer.trigger([root], false));
    expect(pauseSpy).toHaveBeenCalled();
    expect(container.querySelector('video')).toBeTruthy();

    act(() => vi.advanceTimersByTime(3999));
    expect(container.querySelector('video')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('video')).toBeNull();
    expect(loadSpy).toHaveBeenCalled();
  });

  it('pauses active stickers while the browser tab is hidden and resumes them on return', () => {
    let visibilityState = 'visible';
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    try {
      renderMedia(
        <ChatStickerMedia src="/stickers/animated.webm" mimeType="video/webm" autoPlay forceAutoPlay />,
      );
      const root = screen.getByTestId('chat-sticker-media');
      act(() => MockIntersectionObserver.instances[0].trigger([root], true));
      const playCallsBeforeHide = playSpy.mock.calls.length;

      visibilityState = 'hidden';
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(pauseSpy).toHaveBeenCalled();

      visibilityState = 'visible';
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(playSpy.mock.calls.length).toBeGreaterThan(playCallsBeforeHide);
    } finally {
      if (originalDescriptor) Object.defineProperty(document, 'visibilityState', originalDescriptor);
    }
  });

  it('aborts TGS work and destroys its Lottie instance when unloaded', async () => {
    const animation = {
      goToAndStop: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    };
    loadAnimationMock.mockReturnValue(animation);
    let requestSignal;
    globalThis.fetch = vi.fn().mockImplementation(async (_src, options) => {
      requestSignal = options?.signal;
      const bytes = new TextEncoder().encode(JSON.stringify({ v: '5.7.0', fr: 30, ip: 0, op: 1, layers: [] }));
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer,
      };
    });

    renderMedia(
      <ChatStickerMedia
        src="/stickers/animated.tgs"
        mimeType="application/x-tgsticker"
        autoPlay
        forceAutoPlay
      />,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const root = screen.getByTestId('chat-sticker-media');
    act(() => MockIntersectionObserver.instances[0].trigger([root], true));
    await waitFor(() => expect(loadAnimationMock).toHaveBeenCalledTimes(1));
    expect(animation.play).toHaveBeenCalled();

    vi.useFakeTimers();
    act(() => MockIntersectionObserver.instances[0].trigger([root], false));
    expect(animation.pause).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(4000));

    expect(requestSignal?.aborted).toBe(true);
    expect(animation.destroy).toHaveBeenCalledTimes(1);
  });

  it('aborts an unfinished TGS request when the player is unloaded', async () => {
    let requestSignal;
    globalThis.fetch = vi.fn().mockImplementation((_src, options) => {
      requestSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    });

    renderMedia(
      <ChatStickerMedia
        src="/stickers/pending.tgs"
        mimeType="application/x-tgsticker"
        autoPlay
        forceAutoPlay
      />,
    );
    const root = screen.getByTestId('chat-sticker-media');
    act(() => MockIntersectionObserver.instances[0].trigger([root], true));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => MockIntersectionObserver.instances[0].trigger([root], false));
    act(() => vi.advanceTimersByTime(4000));

    expect(requestSignal?.aborted).toBe(true);
    expect(loadAnimationMock).not.toHaveBeenCalled();
  });

  it('loads eagerly without waiting for the shared observer when requested', () => {
    const { container } = renderMedia(
      <ChatStickerMedia
        src="/stickers/preview.webm"
        posterSrc="/stickers/preview.webp"
        mimeType="video/webm"
        autoPlay
        forceAutoPlay
        eager
      />,
    );

    expect(container.querySelector('video')).toHaveAttribute('poster', '/stickers/preview.webp');
    expect(playSpy).toHaveBeenCalled();
  });
});
