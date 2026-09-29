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

    const branchSelect = screen.getByRole('combobox', { name: /Филиал/ });
    expect(branchSelect.closest('.MuiInputBase-root')).toHaveStyle({ height: '44px' });
    ['QR', 'Добавить', 'Акт', 'Ещё'].forEach((name) => {
      expect(screen.getByRole('button', { name })).toHaveStyle({ width: '44px', height: '44px' });
    });
  });

  it('keeps the shared QR scanner and shows consumable add in consumables mode', () => {
    const handlers = renderStrip({ isConsumablesMode: true });

    expect(screen.getByRole('button', { name: 'QR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'QR' }));
    expect(handlers.onOpenQrScanner).toHaveBeenCalledTimes(1);
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
