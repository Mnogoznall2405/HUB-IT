import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import HubCommandPalette from './HubCommandPalette';

const commands = [
  { id: 'tasks', label: 'Задачи', description: 'Раздел HUB', keywords: 'работа' },
  { id: 'chat', label: 'Корпоративный чат', description: 'Раздел HUB', keywords: 'сообщения' },
];

const renderPalette = (props = {}) => {
  const onExecute = vi.fn();
  const result = render(
    <ThemeProvider theme={createTheme()}>
      <HubCommandPalette
        open
        commands={commands}
        onClose={vi.fn()}
        onExecute={onExecute}
        {...props}
      />
    </ThemeProvider>,
  );
  return { ...result, onExecute };
};

describe('HubCommandPalette', () => {
  it('focuses the labelled combobox and exposes a listbox', async () => {
    renderPalette();

    const input = screen.getByRole('combobox', { name: 'Команда или раздел' });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByRole('listbox', { name: 'Доступные команды HUB' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('filters, selects with arrows, and executes with Enter', async () => {
    const { onExecute } = renderPalette();
    const input = screen.getByRole('combobox', { name: 'Команда или раздел' });

    fireEvent.change(input, { target: { value: 'раздел' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onExecute).toHaveBeenCalledWith(commands[1]);
  });

  it('announces an empty result without leaving stale options', () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'несуществующая команда' } });

    expect(screen.getByRole('status')).toHaveTextContent('Подходящих команд нет');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
