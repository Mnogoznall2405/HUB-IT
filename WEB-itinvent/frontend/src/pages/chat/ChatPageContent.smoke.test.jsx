import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSWRCache } from '../../lib/swrCache';

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: React.forwardRef(({ children, ...props }, ref) => (
      <div ref={ref} {...props}>{children}</div>
    )),
  },
}));

const { mockListConversations } = vi.hoisted(() => ({
  mockListConversations: vi.fn(),
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: false,
  TASK_DISCUSSION_CHAT_ENABLED: true,
}));

vi.mock('../../lib/platform', () => ({
  isNativeShellRuntime: () => false,
}));

vi.mock('../../api/client', () => ({
  chatAPI: {
    getHealth: vi.fn().mockResolvedValue({ ok: true }),
    getConversations: mockListConversations,
    ensureNotesConversation: vi.fn().mockResolvedValue(null),
    listAiBots: vi.fn().mockResolvedValue({ items: [] }),
    listChatFolders: vi.fn().mockResolvedValue({ folders: [], conversation_ids_by_folder: {} }),
    searchPeople: vi.fn().mockResolvedValue({ items: [] }),
    searchConversations: vi.fn().mockResolvedValue({ items: [] }),
  },
  mailAPI: {},
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'admin' },
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyApiError: vi.fn(),
    notifyInfo: vi.fn(),
    notifyWarning: vi.fn(),
  }),
}));

vi.mock('../../components/layout/MainLayoutShellContext', () => ({
  useMainLayoutShell: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    headerMode: 'default',
  }),
}));

vi.mock('./ChatShellLayout', () => ({
  default: ({ children, embedded }) => (
    <div data-testid="chat-shell-layout" data-embedded={embedded ? 'true' : 'false'}>{children}</div>
  ),
}));

vi.mock('./ChatPageDesktopLayout', () => ({
  default: ({ sidebarPane, threadPane, resolvedMobileView, gridTemplateColumns }) => (
    <div
      data-testid="chat-page-desktop-layout"
      data-has-sidebar={sidebarPane ? 'true' : 'false'}
      data-active-conversation={threadPane?.props?.activeConversationId || ''}
      data-mobile-view={resolvedMobileView}
      data-grid={gridTemplateColumns}
    />
  ),
}));

vi.mock('./ChatPageDialogsLayer', () => ({
  default: () => null,
}));

vi.mock('./ChatPageMessageChrome', () => ({
  default: () => null,
}));

vi.mock('./ChatPageConversationActionDialog', () => ({
  default: () => null,
}));

vi.mock('./ChatPageFolderDialogsSection', () => ({
  default: () => null,
}));

import { ChatPageContent } from './ChatPageContent';

function LocationProbe({ onLocationChange }) {
  const location = useLocation();
  React.useEffect(() => {
    onLocationChange?.(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search, onLocationChange]);
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderChatPage({
  initialEntry = '/chat',
  content = <ChatPageContent />,
  onLocationChange,
} = {}) {
  const theme = createTheme();
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {content}
        <LocationProbe onLocationChange={onLocationChange} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ChatPageContent smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    clearSWRCache();
    mockListConversations.mockResolvedValue({ items: [] });
  });

  it('mounts without throwing ReferenceError', async () => {
    expect(() => renderChatPage()).not.toThrow();

    await waitFor(() => {
      expect(screen.getByTestId('chat-shell-layout')).toBeInTheDocument();
    });
  });

  it('renders embedded task discussion without a chat sidebar or nested full-page mode', async () => {
    const visitedLocations = [];
    window.sessionStorage.setItem('chat:last-conversation:1', 'conv-regular-1');
    mockListConversations.mockResolvedValue({
      items: [{ id: 'conv-task-1', kind: 'task', task_id: 'task-1', title: 'Task' }],
    });
    renderChatPage({
      initialEntry: '/tasks?task=task-1&task_detail_view=discussion&message=msg-1',
      content: (
        <ChatPageContent
          embedded
          embeddedTaskId="task-1"
          embeddedConversationId="conv-task-1"
          embeddedMessageId="msg-1"
        />
      ),
      onLocationChange: (nextLocation) => visitedLocations.push(nextLocation),
    });

    await waitFor(() => {
      expect(screen.getByTestId('chat-page-desktop-layout')).toHaveAttribute(
        'data-active-conversation',
        'conv-task-1',
      );
    });
    expect(screen.getByTestId('chat-shell-layout')).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByTestId('chat-page-desktop-layout')).toHaveAttribute('data-has-sidebar', 'false');
    expect(visitedLocations).not.toContainEqual(expect.stringMatching(/^\/chat(?:\?|$)/));
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/tasks?task=task-1&task_detail_view=discussion&message=msg-1',
    );
    expect(window.sessionStorage.getItem('chat:last-conversation:1')).toBe('conv-regular-1');
  });

  it('opens the chat inbox instead of returning to a restored task discussion', async () => {
    window.sessionStorage.setItem('chat:last-conversation:1', 'conv-task-1');
    mockListConversations.mockResolvedValue({
      items: [{ id: 'conv-task-1', kind: 'task', task_id: 'task-1', title: 'Task' }],
    });

    renderChatPage({ initialEntry: '/chat' });

    await waitFor(() => {
      expect(mockListConversations).toHaveBeenCalled();
      expect(screen.getByTestId('chat-page-desktop-layout')).toHaveAttribute(
        'data-active-conversation',
        '',
      );
    });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/chat');
  });

  it('replaces a legacy task split link with the canonical task discussion URL', async () => {
    mockListConversations.mockResolvedValue({
      items: [{ id: 'conv-task-1', kind: 'task', task_id: 'task-1', title: 'Task' }],
    });
    renderChatPage({
      initialEntry: '/chat?conversation=conv-task-1&task_layout=split&message=msg-1',
    });

    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent(
        '/tasks?task=task-1&task_detail_view=discussion&message=msg-1',
      );
    });
  });
});
