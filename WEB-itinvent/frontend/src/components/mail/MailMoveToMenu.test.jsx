import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { MailMoveSection } from './MailMoveToMenu';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailMoveSection', () => {
  it('lists folder names under one heading without repeating Переместить в', () => {
    const onSelect = vi.fn();
    renderWithTheme(
      <ul>
        <MailMoveSection
          targets={[
            { value: 'junk', label: 'Нежелательные' },
            { value: 'sent', label: 'Отправленные' },
            { value: 'rss', label: 'RSS-каналы' },
          ]}
          onSelect={onSelect}
        />
      </ul>,
    );

    expect(screen.getByTestId('mail-move-to-heading')).toHaveTextContent('Переместить в');
    expect(screen.getByTestId('mail-move-to-option-sent')).toHaveTextContent('Отправленные');
    expect(screen.queryByText('Переместить в Отправленные')).toBeNull();
    expect(screen.queryByTestId('mail-move-to-search')).toBeNull();
    expect(screen.queryByTestId('mail-move-to-option-rss')).toBeNull();

    fireEvent.click(screen.getByTestId('mail-move-to-option-junk'));
    expect(onSelect).toHaveBeenCalledWith('junk');
  });

  it('filters a long folder list through search', () => {
    const targets = Array.from({ length: 12 }, (_, index) => ({
      value: `folder-${index + 1}`,
      label: index === 4 ? 'Проекты' : `Папка ${index + 1}`,
    }));
    renderWithTheme(
      <ul>
        <MailMoveSection
          targets={targets}
          onSelect={vi.fn()}
        />
      </ul>,
    );

    fireEvent.change(screen.getByTestId('mail-move-to-search'), { target: { value: 'проек' } });
    expect(screen.getByTestId('mail-move-to-option-folder-5')).toHaveTextContent('Проекты');
    expect(screen.queryByTestId('mail-move-to-option-folder-1')).toBeNull();
  });
});
