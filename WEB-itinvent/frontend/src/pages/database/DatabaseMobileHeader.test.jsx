import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import DatabaseMobileHeader from './DatabaseMobileHeader';

const renderHeader = (props = {}) => {
  const theme = createTheme();
  const handlers = {
    onOpenMainDrawer: vi.fn(),
    onDatabaseSelectChange: vi.fn(),
  };

  render(
    <ThemeProvider theme={theme}>
      <DatabaseMobileHeader
        theme={theme}
        databases={[
          { id: 'main', name: 'Основная база' },
          { id: 'archive', name: 'Архив' },
        ]}
        dbName="main"
        currentDb={{ id: 'main', name: 'Основная база' }}
        selectedDatabaseName="Основная база"
        {...handlers}
        {...props}
      />
    </ThemeProvider>
  );

  return handlers;
};

describe('DatabaseMobileHeader', () => {
  it('renders brand and opens the main drawer', () => {
    const handlers = renderHeader();

    expect(screen.getByText('ITINVENT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));

    expect(handlers.onOpenMainDrawer).toHaveBeenCalledTimes(1);
  });

  it('renders selected database and current marker', () => {
    renderHeader();

    expect(screen.getByText('Основная база')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox'));

    expect(screen.getAllByText('Основная база').length).toBeGreaterThan(0);
    expect(screen.getByText('Текущая')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Архив' })).toBeInTheDocument();
  });

  it('delegates database selection changes', () => {
    const handlers = renderHeader();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Архив' }));

    expect(handlers.onDatabaseSelectChange).toHaveBeenCalledTimes(1);
    expect(handlers.onDatabaseSelectChange.mock.calls[0][0].target.value).toBe('archive');
  });

  it('keeps menu access when database list is empty', () => {
    const handlers = renderHeader({ databases: [] });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));

    expect(handlers.onOpenMainDrawer).toHaveBeenCalledTimes(1);
  });
});
