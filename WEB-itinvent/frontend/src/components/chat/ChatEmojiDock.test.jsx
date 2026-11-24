import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatEmojiDock, { EMOJI_DOCK_LAYOUT } from './ChatEmojiDock';

// jsdom не реализует layout: clientWidth мокаем на элементе-обёртке —
// режим дока должен зависеть от реальной ширины контейнера треда,
// а не от фиксированного viewport-breakpoint.
const theme = createTheme();
const ui = { borderSoft: '#dbe3ec', textSecondary: '#64748b' };

const renderDock = (wrapWidth) => {
  const wrap = document.createElement('div');
  Object.defineProperty(wrap, 'clientWidth', { value: wrapWidth, configurable: true });
  document.body.appendChild(wrap);
  const utils = render(
    <ThemeProvider theme={theme}>
      <ChatEmojiDock
        theme={theme}
        ui={ui}
        currentUserId="user-1"
        onInsertEmoji={vi.fn()}
        onSendSticker={vi.fn()}
        onClose={vi.fn()}
      />
    </ThemeProvider>,
    { container: wrap },
  );
  return { wrap, ...utils };
};

describe('ChatEmojiDock layout by container geometry', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses a right column when the thread keeps a usable width', () => {
    renderDock(EMOJI_DOCK_LAYOUT.minWrapWidthForColumn + 120);
    expect(screen.getByTestId('chat-emoji-dock')).toHaveAttribute('data-layout', 'column');
  });

  it('falls back to overlay at the exact boundary minus 1px', () => {
    renderDock(EMOJI_DOCK_LAYOUT.minWrapWidthForColumn - 1);
    expect(screen.getByTestId('chat-emoji-dock')).toHaveAttribute('data-layout', 'overlay');
  });

  it('keeps the thread usable: column width never leaves less than min thread width', () => {
    const wrapWidth = EMOJI_DOCK_LAYOUT.minWrapWidthForColumn;
    renderDock(wrapWidth);
    const dock = screen.getByTestId('chat-emoji-dock');
    expect(dock).toHaveAttribute('data-layout', 'column');
    expect(wrapWidth - EMOJI_DOCK_LAYOUT.columnWidth).toBeGreaterThanOrEqual(
      EMOJI_DOCK_LAYOUT.minThreadWidth,
    );
  });
});
