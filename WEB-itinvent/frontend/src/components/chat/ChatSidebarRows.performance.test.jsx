import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, initial, animate, transition, ...props }, ref) => (
      <div ref={ref} {...props}>{children}</div>
    )),
  },
}));

vi.mock('@mui/material', () => ({
  Checkbox: () => null,
  CircularProgress: () => null,
  Menu: ({ children }) => <>{children}</>,
  MenuItem: ({ children }) => <>{children}</>,
  Skeleton: () => null,
  Tooltip: ({ children }) => <>{children}</>,
}));

vi.mock('./ChatCommon', () => ({
  AiConversationAvatar: () => null,
  ConversationAvatar: () => null,
  PresenceAvatar: () => null,
}));

import { ConversationRow } from './ChatSidebarRows';

describe('ConversationRow render isolation', () => {
  it('prefetches a desktop thread before click on pointer hover', () => {
    const theme = createTheme();
    const onPrefetchConversation = vi.fn();

    render(
      <ThemeProvider theme={theme}>
        <ConversationRow
          item={{ id: 'conv-1', kind: 'direct', title: 'Dialog', unread_count: 0 }}
          theme={theme}
          ui={{ density: {} }}
          active={false}
          onOpenConversation={vi.fn()}
          onPrefetchConversation={onPrefetchConversation}
          onOpenFolderMenu={vi.fn()}
          draftPreview=""
          compactMobile={false}
          index={0}
          reducedMotion
          skipEnterAnimation={false}
        />
      </ThemeProvider>,
    );

    fireEvent.pointerEnter(screen.getByText('Dialog'));

    expect(onPrefetchConversation).toHaveBeenCalledWith('conv-1');
  });

  it('does not rerender an unchanged row when its parent rerenders', () => {
    const theme = createTheme();
    const ui = { density: {} };
    let titleReads = 0;
    const item = {
      id: 'conv-1',
      kind: 'direct',
      unread_count: 0,
      get title() {
        titleReads += 1;
        return 'Dialog';
      },
    };
    const props = {
      item,
      theme,
      ui,
      active: false,
      onOpenConversation: vi.fn(),
      onPrefetchConversation: vi.fn(),
      onOpenFolderMenu: vi.fn(),
      draftPreview: '',
      compactMobile: false,
      index: 0,
      reducedMotion: true,
      skipEnterAnimation: false,
    };
    const view = (marker) => (
      <ThemeProvider theme={theme}>
        <div data-marker={marker}>
          <ConversationRow {...props} />
        </div>
      </ThemeProvider>
    );

    const { rerender } = render(view('first'));
    const readsAfterFirstRender = titleReads;
    expect(readsAfterFirstRender).toBeGreaterThan(0);

    rerender(view('second'));
    expect(titleReads).toBe(readsAfterFirstRender);
  });

  it('rerenders only the rows whose active state changes', () => {
    const theme = createTheme();
    const ui = { density: {} };
    const titleReads = { 'conv-1': 0, 'conv-2': 0, 'conv-3': 0 };
    const items = Object.keys(titleReads).map((id) => ({
      id,
      kind: 'direct',
      unread_count: 0,
      get title() {
        titleReads[id] += 1;
        return id;
      },
    }));
    const stableProps = {
      theme,
      ui,
      onOpenConversation: vi.fn(),
      onPrefetchConversation: vi.fn(),
      onOpenFolderMenu: vi.fn(),
      draftPreview: '',
      compactMobile: false,
      reducedMotion: true,
      skipEnterAnimation: false,
    };
    const view = (activeId) => (
      <ThemeProvider theme={theme}>
        {items.map((item, index) => (
          <ConversationRow
            key={item.id}
            {...stableProps}
            item={item}
            index={index}
            active={item.id === activeId}
          />
        ))}
      </ThemeProvider>
    );

    const { rerender } = render(view('conv-1'));
    const thirdRowReads = titleReads['conv-3'];
    rerender(view('conv-2'));

    expect(titleReads['conv-1']).toBeGreaterThan(1);
    expect(titleReads['conv-2']).toBeGreaterThan(1);
    expect(titleReads['conv-3']).toBe(thirdRowReads);
  });
});
