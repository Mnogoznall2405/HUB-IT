import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailToolsMenu from './MailToolsMenu';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailToolsMenu', () => {
  it('keeps only mark-all-read and view settings on desktop', () => {
    const anchorEl = document.createElement('button');
    document.body.appendChild(anchorEl);

    renderWithTheme(
      <MailToolsMenu
        anchorEl={anchorEl}
        open
        onClose={vi.fn()}
        onMarkAllRead={vi.fn()}
        onOpenViewSettings={vi.fn()}
      />,
    );

    expect(screen.getByText('Отметить все как прочитанные')).toBeTruthy();
    expect(screen.getByText('Настройки вида')).toBeTruthy();
    expect(screen.queryByText('Шаблоны')).toBeNull();
    expect(screen.queryByText('Подпись')).toBeNull();
    expect(screen.queryByText('Заявка в IT')).toBeNull();
  });

  it('keeps only mark-all-read and view settings in the mobile bottom sheet', () => {
    renderWithTheme(
      <MailToolsMenu
        open
        mobile
        onClose={vi.fn()}
        onMarkAllRead={vi.fn()}
        onOpenViewSettings={vi.fn()}
      />,
    );

    expect(screen.getByText('Отметить все как прочитанные')).toBeTruthy();
    expect(screen.getByText('Настройки вида')).toBeTruthy();
    expect(screen.queryByText('Шаблоны')).toBeNull();
    expect(screen.queryByText('Подпись')).toBeNull();
    expect(screen.queryByText('Заявка в IT')).toBeNull();
  });
});
