import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import DatabaseSearchBar from './DatabaseSearchBar';

const theme = createTheme();

describe('DatabaseSearchBar', () => {
  it('uses the equipment placeholder by default', () => {
    render(<DatabaseSearchBar value="" theme={theme} />);

    expect(screen.getByPlaceholderText('Поиск по инв. №, модели, сотруднику...')).toBeInTheDocument();
  });

  it('uses the consumables placeholder in consumables mode', () => {
    render(<DatabaseSearchBar isConsumablesMode value="" theme={theme} />);

    expect(screen.getByPlaceholderText('Поиск по ID, типу, модели...')).toBeInTheDocument();
  });

  it('passes input changes to the parent', () => {
    const changes = [];
    const onChange = vi.fn((event) => {
      changes.push(event.target.value);
    });

    render(<DatabaseSearchBar value="" onChange={onChange} theme={theme} />);

    fireEvent.change(screen.getByPlaceholderText('Поиск по инв. №, модели, сотруднику...'), {
      target: { value: 'laser' },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(changes).toEqual(['laser']);
  });

  it('shows clear button only for non-empty values and calls onClear', () => {
    const onClear = vi.fn();
    const { rerender } = render(<DatabaseSearchBar value="" onClear={onClear} theme={theme} />);

    expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument();

    rerender(<DatabaseSearchBar value="laser" onClear={onClear} theme={theme} />);
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('passes Enter keydown to the parent handler', () => {
    const onKeyDown = vi.fn();

    render(<DatabaseSearchBar value="laser" onKeyDown={onKeyDown} theme={theme} />);

    fireEvent.keyDown(screen.getByDisplayValue('laser'), { key: 'Enter', code: 'Enter' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0].key).toBe('Enter');
  });
});
