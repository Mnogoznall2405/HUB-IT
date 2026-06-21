import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import DatabaseMobileHeader from './DatabaseMobileHeader';

const renderHeader = (props = {}) => {
  const theme = createTheme();
  const handlers = {
    onDatabaseSelectChange: vi.fn(),
  };

  render(
    <ThemeProvider theme={theme}>
      <DatabaseMobileHeader
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
  it('renders brand and selected database', () => {
    renderHeader();

    expect(screen.getByTestId('mobile-shell-page-header')).toBeInTheDocument();
    expect(screen.getByText('HUB-IT')).toBeInTheDocument();
    expect(screen.getByText('Основная база')).toBeInTheDocument();
  });

  it('renders current database marker in the selector menu', () => {
    renderHeader();

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

  it('renders brand without database selector when database list is empty', () => {
    renderHeader({ databases: [] });

    expect(screen.getByText('HUB-IT')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
