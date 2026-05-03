import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import DatabaseMobileActions from './DatabaseMobileActions';
import { PRINTER_COMPONENT_OPTIONS } from './equipmentModel';

const renderActions = (props = {}) => {
  const theme = createTheme();
  const ui = buildOfficeUiTokens(theme);
  const handlers = {
    onFabSheetOpenChange: vi.fn(),
    onClearSelection: vi.fn(),
    onOpenQrScanner: vi.fn(),
    onIdentifyWorkspace: vi.fn(),
    onOpenUploadAct: vi.fn(),
    onOpenAddEquipment: vi.fn(),
    onOpenAddConsumable: vi.fn(),
    onOpenTransferForSelection: vi.fn(),
    onOpenTransferActForSelection: vi.fn(),
    onOpenCartridgeForSelection: vi.fn(),
    onOpenBatteryForSelection: vi.fn(),
    onOpenComponentForSelection: vi.fn(),
    onBranchChange: vi.fn(),
    onLoadMore: vi.fn(),
    onCollapseAll: vi.fn(),
    onEnterSelectionMode: vi.fn(),
  };

  render(
    <ThemeProvider theme={theme}>
      <DatabaseMobileActions
        theme={theme}
        ui={ui}
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

  return handlers;
};

describe('DatabaseMobileActions', () => {
  it('clears selection from the selection FAB', () => {
    const handlers = renderActions({
      mobileSelectionMode: true,
      selectedItemsCount: 2,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('opens the controlled drawer from the regular FAB with haptic feedback', () => {
    const vibrate = vi.fn();
    const originalVibrate = navigator.vibrate;
    navigator.vibrate = vibrate;
    const handlers = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Open actions' }));

    expect(vibrate).toHaveBeenCalledWith(10);
    expect(handlers.onFabSheetOpenChange).toHaveBeenCalledWith(true);

    navigator.vibrate = originalVibrate;
  });

  it('calls scanner and add callbacks and closes the drawer', () => {
    const handlers = renderActions({
      fabSheetOpen: true,
      canDatabaseWrite: true,
    });

    fireEvent.click(screen.getByText('QR Сканер'));
    expect(handlers.onOpenQrScanner).toHaveBeenCalledTimes(1);
    expect(handlers.onFabSheetOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByText('Загрузить акт'));
    expect(handlers.onOpenUploadAct).toHaveBeenCalledTimes(1);
    expect(handlers.onFabSheetOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByText('Добавить оборудование'));
    expect(handlers.onOpenAddEquipment).toHaveBeenCalledTimes(1);
    expect(handlers.onFabSheetOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('calls consumable add callback in consumables mode', () => {
    const handlers = renderActions({
      fabSheetOpen: true,
      isConsumablesMode: true,
      canDatabaseWrite: true,
    });

    fireEvent.click(screen.getByText('Добавить расходник'));

    expect(handlers.onOpenAddConsumable).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenQrScanner).not.toHaveBeenCalled();
    expect(screen.queryByText('QR Сканер')).not.toBeInTheDocument();
  });

  it('respects selected-action capabilities for disabled operations', () => {
    const handlers = renderActions({
      canDatabaseWrite: true,
      selectedItemsCount: 3,
      selectedItemsCapabilities: {
        canCartridge: false,
        canBattery: false,
        canComponent: false,
        componentKind: 'printer',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Картридж' }));
    fireEvent.click(screen.getByRole('button', { name: 'Батарея' }));
    fireEvent.click(screen.getByRole('button', { name: 'Компонент' }));

    expect(handlers.onOpenCartridgeForSelection).not.toHaveBeenCalled();
    expect(handlers.onOpenBatteryForSelection).not.toHaveBeenCalled();
    expect(handlers.onOpenComponentForSelection).not.toHaveBeenCalled();
  });

  it('opens enabled selected component action with resolved defaults', () => {
    const handlers = renderActions({
      canDatabaseWrite: true,
      selectedItemsCount: 1,
      selectedItemsCapabilities: {
        canCartridge: false,
        canBattery: false,
        canComponent: true,
        componentKind: 'printer',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Компонент' }));

    expect(handlers.onOpenComponentForSelection).toHaveBeenCalledWith({
      componentKind: 'printer',
      componentType: PRINTER_COMPONENT_OPTIONS[0].value,
    });
  });

  it('delegates controlled management actions from the drawer', () => {
    const handlers = renderActions({
      fabSheetOpen: true,
      branches: [{ BRANCH_NO: 1, BRANCH_NAME: 'HQ' }],
      selectedBranch: '',
      canLoadMore: true,
      nextEquipmentPage: 2,
      equipmentPagesTotal: 4,
      hasExpandedVisible: true,
    });

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Р¤РёР»РёР°Р»/ }));
    fireEvent.click(screen.getByRole('option', { name: 'HQ' }));
    fireEvent.click(screen.getByText('Р—Р°РіСЂСѓР·РёС‚СЊ РµС‰С‘'));
    fireEvent.click(screen.getByText('РЎРІРµСЂРЅСѓС‚СЊ СЂР°Р·РґРµР»С‹'));
    fireEvent.click(screen.getByText((text) => text.includes('РµР¶РёРј') && text.includes('РІС‹Р±РѕСЂР°')));

    expect(handlers.onBranchChange).toHaveBeenCalledWith('HQ');
    expect(handlers.onLoadMore).toHaveBeenCalledTimes(1);
    expect(handlers.onCollapseAll).toHaveBeenCalledTimes(1);
    expect(handlers.onEnterSelectionMode).toHaveBeenCalledTimes(1);
  });
});
