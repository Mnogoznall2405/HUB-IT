import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import DatabaseSelectionBar from './DatabaseSelectionBar';
import {
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
} from './equipmentModel';

const renderSelectionBar = (props = {}) => {
  const theme = createTheme();
  const ui = buildOfficeUiTokens(theme);
  const handlers = {
    onClearSelection: vi.fn(),
    onOpenTransfer: vi.fn(),
    onOpenTransferAct: vi.fn(),
    onOpenCartridge: vi.fn(),
    onOpenBattery: vi.fn(),
    onOpenComponent: vi.fn(),
  };

  const result = render(
    <ThemeProvider theme={theme}>
      <DatabaseSelectionBar
        theme={theme}
        ui={ui}
        selectedItemsCount={3}
        selectedVisibleCount={2}
        selectedHiddenCount={1}
        selectedItemsCapabilities={{
          canCartridge: true,
          canBattery: true,
          canComponent: true,
          componentKind: 'printer',
        }}
        {...handlers}
        {...props}
      />
    </ThemeProvider>
  );

  return { ...result, handlers };
};

describe('DatabaseSelectionBar', () => {
  it('renders selected and hidden counters', () => {
    renderSelectionBar({
      selectedItemsCount: 5,
      selectedVisibleCount: 3,
      selectedHiddenCount: 2,
    });

    expect(screen.getByText('Выбрано: 5')).toBeInTheDocument();
    expect(screen.getByText('В фильтре видно: 3, скрыто: 2')).toBeInTheDocument();
  });

  it('calls clear selection handler', () => {
    const { handlers } = renderSelectionBar();

    fireEvent.click(screen.getByRole('button', { name: 'Очистить выбор' }));

    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('calls transfer handler', () => {
    const { handlers } = renderSelectionBar();

    fireEvent.click(screen.getByRole('button', { name: 'Переместить' }));

    expect(handlers.onOpenTransfer).toHaveBeenCalledTimes(1);
  });

  it('disables cartridge, battery, and component actions by capabilities', () => {
    const { handlers } = renderSelectionBar({
      selectedItemsCapabilities: {
        canCartridge: false,
        canBattery: false,
        canComponent: false,
        componentKind: 'printer',
      },
    });

    const cartridge = screen.getByRole('button', { name: 'Картридж' });
    const battery = screen.getByRole('button', { name: 'Батарея' });
    const component = screen.getByRole('button', { name: 'Компонент' });

    expect(cartridge).toBeDisabled();
    expect(battery).toBeDisabled();
    expect(component).toBeDisabled();

    fireEvent.click(cartridge);
    fireEvent.click(battery);
    fireEvent.click(component);

    expect(handlers.onOpenCartridge).not.toHaveBeenCalled();
    expect(handlers.onOpenBattery).not.toHaveBeenCalled();
    expect(handlers.onOpenComponent).not.toHaveBeenCalled();
  });

  it('passes selected pc component kind and first option type', () => {
    const { handlers } = renderSelectionBar({
      selectedItemsCapabilities: {
        canCartridge: false,
        canBattery: false,
        canComponent: true,
        componentKind: 'pc',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Компонент' }));

    expect(handlers.onOpenComponent).toHaveBeenCalledWith({
      componentKind: 'pc',
      componentType: PC_COMPONENT_OPTIONS[0].value,
    });
  });

  it('uses printer component kind and first option type by default', () => {
    const { handlers } = renderSelectionBar({
      selectedItemsCapabilities: {
        canCartridge: false,
        canBattery: false,
        canComponent: true,
        componentKind: null,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Компонент' }));

    expect(handlers.onOpenComponent).toHaveBeenCalledWith({
      componentKind: 'printer',
      componentType: PRINTER_COMPONENT_OPTIONS[0].value,
    });
  });
});
