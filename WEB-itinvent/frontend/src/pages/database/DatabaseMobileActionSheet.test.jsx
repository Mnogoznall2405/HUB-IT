import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import DatabaseMobileActionSheet from './DatabaseMobileActionSheet';

describe('DatabaseMobileActionSheet', () => {
  it('renders secondary actions and closes after click', () => {
    const onClose = vi.fn();
    const onEnterSelectionMode = vi.fn();
    const theme = createTheme();

    render(
      <ThemeProvider theme={theme}>
        <DatabaseMobileActionSheet
          theme={theme}
          open
          onClose={onClose}
          onEnterSelectionMode={onEnterSelectionMode}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText('Режим выбора'));

    expect(onEnterSelectionMode).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
