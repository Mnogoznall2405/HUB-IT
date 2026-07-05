import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import DatabaseBulkActionBar from './DatabaseBulkActionBar';
import { PRINTER_COMPONENT_OPTIONS } from './equipmentModel';

const renderBar = (props = {}) => {
  const theme = createTheme();
  const ui = buildOfficeUiTokens(theme);
  const handlers = {
    onClearSelection: vi.fn(),
    onOpenLocationTransfer: vi.fn(),
    onOpenTransfer: vi.fn(),
    onOpenTransferAct: vi.fn(),
    onOpenCartridge: vi.fn(),
    onOpenBattery: vi.fn(),
    onOpenComponent: vi.fn(),
  };

  render(
    <ThemeProvider theme={theme}>
      <DatabaseBulkActionBar
        theme={theme}
        ui={ui}
        selectedItemsCount={2}
        selectedItemsCapabilities={{
          canCartridge: true,
          canBattery: true,
          canComponent: true,
          componentKind: 'printer',
        }}
        {...handlers}
        {...props}
      />
    </ThemeProvider>,
  );

  return handlers;
};

describe('DatabaseBulkActionBar', () => {
  it('renders compact mobile quick actions and opens maintenance sheet', () => {
    renderBar({ variant: 'mobile' });

    expect(screen.getByTestId('database-bulk-action-bar')).toHaveAttribute('data-variant', 'mobile');
    expect(screen.getByLabelText('Выбрано: 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перемещ.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'С актом' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Акт' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));

    const moreList = screen.getByTestId('database-bulk-mobile-more-list');
    expect(within(moreList).getByText('Картридж')).toBeInTheDocument();
    expect(within(moreList).getByText('Батарея')).toBeInTheDocument();
    expect(within(moreList).getByText('Компонент')).toBeInTheDocument();
  });

  it('disables maintenance actions in the mobile sheet when capabilities are false', () => {
    renderBar({
      variant: 'mobile',
      selectedItemsCapabilities: {
        canCartridge: false,
        canBattery: false,
        canComponent: false,
        componentKind: 'printer',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));

    const moreList = screen.getByTestId('database-bulk-mobile-more-list');
    expect(within(moreList).getByRole('button', { name: 'Картридж' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(moreList).getByRole('button', { name: 'Батарея' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(moreList).getByRole('button', { name: 'Компонент' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens component action with defaults from the mobile sheet', () => {
    const handlers = renderBar({ variant: 'mobile' });

    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    fireEvent.click(screen.getByText('Компонент'));

    expect(handlers.onOpenComponent).toHaveBeenCalledWith({
      componentKind: 'printer',
      componentType: PRINTER_COMPONENT_OPTIONS[0].value,
    });
  });

  it('keeps desktop maintenance buttons visible', () => {
    renderBar({ variant: 'desktop' });

    expect(screen.getByRole('button', { name: 'Картридж' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Батарея' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Компонент' })).toBeInTheDocument();
  });
});
