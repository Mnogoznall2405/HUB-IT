import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import DatabaseDesktopToolbar from './DatabaseDesktopToolbar';

const renderToolbar = (props = {}) => {
  const theme = createTheme();
  const ui = buildOfficeUiTokens(theme);
  const handlers = {
    onOpenQrScanner: vi.fn(),
    onIdentifyWorkspace: vi.fn(),
    onOpenUploadAct: vi.fn(),
    onOpenAddEquipment: vi.fn(),
    onOpenAddConsumable: vi.fn(),
    onBranchChange: vi.fn(),
    onCollapseAll: vi.fn(),
  };

  render(
    <ThemeProvider theme={theme}>
      <DatabaseDesktopToolbar
        theme={theme}
        ui={ui}
        branches={[
          { BRANCH_NO: 1, BRANCH_NAME: 'HQ' },
          { BRANCH_NO: 2, BRANCH_NAME: 'Remote' },
        ]}
        selectedBranch=""
        {...handlers}
        {...props}
      />
    </ThemeProvider>
  );

  return handlers;
};

describe('DatabaseDesktopToolbar', () => {
  it('hides write action buttons without database write permission', () => {
    renderToolbar({ canDatabaseWrite: false });

    expect(screen.getByRole('button', { name: /QR/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить акт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить оборудование' })).not.toBeInTheDocument();
  });

  it('hides consumable write action without database write permission', () => {
    renderToolbar({
      canDatabaseWrite: false,
      isConsumablesMode: true,
    });

    expect(screen.queryByRole('button', { name: 'Добавить расходник' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /QR/ })).not.toBeInTheDocument();
  });

  it('calls branch change handler from the branch select', () => {
    const handlers = renderToolbar();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Remote' }));

    expect(handlers.onBranchChange).toHaveBeenCalledWith('Remote');
  });

  it('shows collapse button only when expanded sections are visible', () => {
    const theme = createTheme();
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <DatabaseDesktopToolbar
          theme={theme}
          ui={buildOfficeUiTokens(theme)}
          hasExpandedVisible={false}
        />
      </ThemeProvider>
    );

    expect(screen.queryByRole('button', { name: 'Свернуть разделы' })).not.toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <DatabaseDesktopToolbar
          theme={theme}
          ui={buildOfficeUiTokens(theme)}
          hasExpandedVisible
        />
      </ThemeProvider>
    );

    expect(screen.getByRole('button', { name: 'Свернуть разделы' })).toBeInTheDocument();
  });
});
