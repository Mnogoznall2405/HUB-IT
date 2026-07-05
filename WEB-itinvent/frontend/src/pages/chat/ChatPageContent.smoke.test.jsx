import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: React.forwardRef(({ children, ...props }, ref) => (
      <div ref={ref} {...props}>{children}</div>
    )),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: false,
  CHAT_WS_ENABLED: false,
}));

vi.mock('../../lib/platform', () => ({
  isNativeShellRuntime: () => false,
}));

vi.mock('../../api/client', () => ({
  chatAPI: {
    getHealth: vi.fn().mockResolvedValue({ ok: true }),
    listConversations: vi.fn().mockResolvedValue({ items: [] }),
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
  default: ({ children }) => <div data-testid="chat-shell-layout">{children}</div>,
}));

vi.mock('./ChatPageDesktopLayout', () => ({
  default: () => <div data-testid="chat-page-desktop-layout" />,
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

function renderChatPage() {
  const theme = createTheme();
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/chat']}>
        <ChatPageContent />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ChatPageContent smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('mounts without throwing ReferenceError', async () => {
    expect(() => renderChatPage()).not.toThrow();

    await waitFor(() => {
      expect(screen.getByTestId('chat-shell-layout')).toBeInTheDocument();
    });
  });
});
