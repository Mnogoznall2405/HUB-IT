import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DesktopPresenceBootstrap from './DesktopPresenceBootstrap';

const mocks = vi.hoisted(() => ({
  user: { id: 7 },
  native: true,
  heartbeat: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../lib/platform', () => ({
  isNativeShellRuntime: () => mocks.native,
}));

vi.mock('../../api/desktopPresence', () => ({
  desktopPresenceAPI: {
    heartbeat: mocks.heartbeat,
    disconnect: mocks.disconnect,
  },
}));

describe('DesktopPresenceBootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    mocks.user = { id: 7 };
    mocks.native = true;
    mocks.heartbeat.mockReset();
    mocks.disconnect.mockReset();
    mocks.heartbeat.mockResolvedValue({ active: true, expires_in_seconds: 180 });
    mocks.disconnect.mockResolvedValue({ active: false, expires_in_seconds: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('heartbeats immediately and then about once per minute', async () => {
    const { unmount } = render(<DesktopPresenceBootstrap />);

    await act(async () => Promise.resolve());
    expect(mocks.heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(mocks.heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2);

    unmount();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('never overlaps heartbeat requests and retries after a network failure', async () => {
    let resolveFirst;
    mocks.heartbeat.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirst = resolve;
    }));

    render(<DesktopPresenceBootstrap />);
    await act(async () => Promise.resolve());
    expect(mocks.heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(mocks.heartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ active: true, expires_in_seconds: 180 });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('does nothing in a normal browser or before authentication restores', async () => {
    mocks.native = false;
    const { rerender } = render(<DesktopPresenceBootstrap />);
    await act(async () => Promise.resolve());
    expect(mocks.heartbeat).not.toHaveBeenCalled();

    mocks.native = true;
    mocks.user = null;
    rerender(<DesktopPresenceBootstrap />);
    await act(async () => Promise.resolve());
    expect(mocks.heartbeat).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it('sends only one best-effort disconnect on pagehide and unmount', async () => {
    const { unmount } = render(<DesktopPresenceBootstrap />);
    await act(async () => Promise.resolve());

    act(() => window.dispatchEvent(new Event('pagehide')));
    unmount();

    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
