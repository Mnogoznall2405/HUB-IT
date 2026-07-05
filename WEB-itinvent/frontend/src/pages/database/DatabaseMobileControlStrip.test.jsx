import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import DatabaseMobileControlStrip from './DatabaseMobileControlStrip';

const renderStrip = (props = {}) => {
  const theme = createTheme();
  const handlers = {
    onBranchChange: vi.fn(),
    onCollapseAll: vi.fn(),
    onOpenQrScanner: vi.fn(),
    onOpenUploadAct: vi.fn(),
    onOpenAddEquipment: vi.fn(),
    onOpenAddConsumable: vi.fn(),
    onOpenMore: vi.fn(),
  };

  render(
    <ThemeProvider theme={theme}>
      <DatabaseMobileControlStrip
        theme={theme}
        branches={[{ BRANCH_NO: 1, BRANCH_NAME: 'HQ' }]}
        canDatabaseWrite
        {...handlers}
        {...props}
      />
    </ThemeProvider>,
  );

  return handlers;
};

describe('DatabaseMobileControlStrip', () => {
  it('shows branch selector and equipment quick actions', () => {
    renderStrip();

    expect(screen.getByRole('combobox', { name: /Филиал/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'QR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Акт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ещё' })).toBeInTheDocument();
  });

  it('shows consumable add action in consumables mode', () => {
    renderStrip({ isConsumablesMode: true });

    expect(screen.queryByRole('button', { name: 'QR' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();
  });

  it('delegates quick action callbacks', () => {
    const handlers = renderStrip();

    fireEvent.click(screen.getByRole('button', { name: 'QR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Акт' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));

    expect(handlers.onOpenQrScanner).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenUploadAct).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenMore).toHaveBeenCalledTimes(1);
  });
});
