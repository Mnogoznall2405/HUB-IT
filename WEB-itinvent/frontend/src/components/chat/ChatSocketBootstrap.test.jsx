import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatMocks = vi.hoisted(() => ({
  recoverAfterSystemResume: vi.fn(() => true),
  resetAuthBlock: vi.fn(),
  subscribeInbox: vi.fn(() => Promise.resolve()),
  unsubscribeInbox: vi.fn(),
  retain: vi.fn(() => () => {}),
  getConnectionState: vi.fn(() => 'connected'),
  authBlocked: false,
  wantInbox: true,
}));

const authMocks = vi.hoisted(() => ({
  refresh: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7 },
    hasPermission: () => true,
  }),
}));

vi.mock('../../lib/chatSocket', () => ({
  CHAT_SOCKET_SESSION_EXPIRED_EVENT: 'chat-ws-session-expired',
  chatSocket: chatMocks,
}));

vi.mock('../../api/client', () => ({
  authAPI: {
    refresh: (...args) => authMocks.refresh(...args),
  },
}));

vi.mock('../../lib/debugClientLog', () => ({
  emitAgentDebugLog: vi.fn(),
}));

import ChatSocketBootstrap, { AUTH_TOKEN_REFRESHED_EVENT } from './ChatSocketBootstrap';
import { CHAT_SOCKET_SESSION_EXPIRED_EVENT } from '../../lib/chatSocket';
import { DESKTOP_LIFECYCLE_RECOVERY_EVENT } from '../../lib/desktopLifecycle';

const flushMicrotasks = async (times = 2) => {
  for (let index = 0; index < times; index += 1) {
    await act(async () => Promise.resolve());
  }
};

describe('ChatSocketBootstrap desktop recovery', () => {
  beforeEach(() => {
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();
    chatMocks.subscribeInbox.mockReset();
    chatMocks.subscribeInbox.mockResolvedValue(undefined);
    chatMocks.getConnectionState.mockReturnValue('connected');
    chatMocks.authBlocked = false;
    chatMocks.wantInbox = true;
    authMocks.refresh.mockReset();
    authMocks.refresh.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces auth-token-refreshed and desktop lifecycle into one reconnect', async () => {
    render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();
    chatMocks.subscribeInbox.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT));
      window.dispatchEvent(new CustomEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT));
    });
    await flushMicrotasks();

    expect(chatMocks.recoverAfterSystemResume).toHaveBeenCalledTimes(1);
    expect(chatMocks.resetAuthBlock).not.toHaveBeenCalled();
  });

  it('coalesces disconnected token refresh and desktop lifecycle into one reconnect', async () => {
    chatMocks.getConnectionState.mockReturnValue('disconnected');
    render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());
    chatMocks.resetAuthBlock.mockClear();
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.subscribeInbox.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT));
      window.dispatchEvent(new CustomEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT));
    });
    await flushMicrotasks();

    expect(chatMocks.recoverAfterSystemResume).toHaveBeenCalledTimes(1);
    expect(chatMocks.resetAuthBlock).not.toHaveBeenCalled();
  });

  it('does not skip a zombie OPEN socket when token refresh and lifecycle overlap', async () => {
    chatMocks.getConnectionState.mockReturnValue('connected');
    chatMocks.authBlocked = false;
    render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT));
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT));
    });
    await flushMicrotasks();

    expect(chatMocks.recoverAfterSystemResume).toHaveBeenCalledTimes(1);
    expect(chatMocks.resetAuthBlock).not.toHaveBeenCalled();
  });

  it('does not reconnect on a healthy token refresh without a lifecycle force', async () => {
    render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();
    chatMocks.subscribeInbox.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT));
    });
    await flushMicrotasks();

    expect(chatMocks.recoverAfterSystemResume).not.toHaveBeenCalled();
    expect(chatMocks.resetAuthBlock).not.toHaveBeenCalled();
  });

  it('forces resume when lifecycle arrives while session refresh is pending', async () => {
    let resolveRefresh;
    authMocks.refresh.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();
    chatMocks.subscribeInbox.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_SESSION_EXPIRED_EVENT));
    });
    await act(async () => Promise.resolve());
    expect(authMocks.refresh).toHaveBeenCalledTimes(1);
    expect(chatMocks.recoverAfterSystemResume).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new CustomEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT));
    });
    resolveRefresh({});
    await flushMicrotasks(4);

    expect(chatMocks.recoverAfterSystemResume).toHaveBeenCalledTimes(1);
    expect(chatMocks.resetAuthBlock).not.toHaveBeenCalled();
  });

  it('forces a follow-up resume when lifecycle arrives during subscribeInbox', async () => {
    chatMocks.getConnectionState.mockReturnValue('disconnected');
    render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());

    let resolveInbox;
    chatMocks.subscribeInbox.mockImplementation(() => new Promise((resolve) => {
      resolveInbox = resolve;
    }));
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT));
    });
    await flushMicrotasks();
    expect(chatMocks.resetAuthBlock).toHaveBeenCalledTimes(1);
    expect(chatMocks.recoverAfterSystemResume).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new CustomEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT));
    });
    resolveInbox();
    await flushMicrotasks(4);

    expect(chatMocks.recoverAfterSystemResume).toHaveBeenCalledTimes(1);
  });

  it('coalesces ten lifecycle events during in-flight recovery into one forced follow-up', async () => {
    chatMocks.getConnectionState.mockReturnValue('disconnected');
    render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());

    let resolveInbox;
    chatMocks.subscribeInbox.mockImplementation(() => new Promise((resolve) => {
      resolveInbox = resolve;
    }));
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT));
    });
    await flushMicrotasks();

    act(() => {
      for (let index = 0; index < 10; index += 1) {
        window.dispatchEvent(new CustomEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT));
      }
    });
    resolveInbox();
    await flushMicrotasks(4);

    expect(chatMocks.recoverAfterSystemResume).toHaveBeenCalledTimes(1);
  });

  it('does not run a forced follow-up after unmount', async () => {
    chatMocks.getConnectionState.mockReturnValue('disconnected');
    const { unmount } = render(<ChatSocketBootstrap />);
    await act(async () => Promise.resolve());

    let resolveInbox;
    chatMocks.subscribeInbox.mockImplementation(() => new Promise((resolve) => {
      resolveInbox = resolve;
    }));
    chatMocks.recoverAfterSystemResume.mockClear();
    chatMocks.resetAuthBlock.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT));
    });
    await flushMicrotasks();

    act(() => {
      window.dispatchEvent(new CustomEvent(DESKTOP_LIFECYCLE_RECOVERY_EVENT));
    });
    unmount();
    resolveInbox();
    await flushMicrotasks(4);

    expect(chatMocks.recoverAfterSystemResume).not.toHaveBeenCalled();
  });
});
