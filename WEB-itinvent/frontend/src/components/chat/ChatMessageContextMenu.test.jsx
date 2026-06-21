import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatMessageContextMenu from './ChatMessageContextMenu';

const theme = createTheme();
const ui = {
  drawerBg: '#17212b',
  surfaceMuted: '#232e3c',
  textStrong: '#f5f7fa',
  shadowStrong: '0 16px 48px rgba(0, 0, 0, 0.44)',
};

function renderMenu(overrides = {}) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  return render(
    <ThemeProvider theme={theme}>
      <ChatMessageContextMenu
        theme={theme}
        ui={ui}
        open
        onClose={vi.fn()}
        anchorEl={anchor}
        message={{ id: 'msg-1', kind: 'text', body: 'hello', is_own: true }}
        activeConversation={{ id: 'conv-1', kind: 'direct' }}
        activeConversationId="conv-1"
        onToggleReactionFromMenu={vi.fn()}
        onReplyFromMessageMenu={vi.fn()}
        onCopyMessage={vi.fn()}
        onSelectMessageFromMenu={vi.fn()}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

describe('ChatMessageContextMenu reactions', () => {
  it('shows more reactions when expanded than when collapsed', () => {
    renderMenu();

    const collapsedCount = screen.getAllByLabelText(/^Реакция /).length;
    expect(collapsedCount).toBeGreaterThan(0);
    expect(collapsedCount).toBeLessThan(16);

    fireEvent.click(screen.getByRole('button', { name: 'Ещё реакции' }));

    const expandedCount = screen.getAllByLabelText(/^Реакция /).length;
    expect(expandedCount).toBe(16);
    expect(expandedCount).toBeGreaterThan(collapsedCount);
  });
});
