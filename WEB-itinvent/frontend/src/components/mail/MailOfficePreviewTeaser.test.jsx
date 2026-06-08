import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailOfficePreviewTeaser from './MailOfficePreviewTeaser';

const renderWithTheme = (node) => render(
  <ThemeProvider theme={createTheme()}>
    {node}
  </ThemeProvider>,
);

describe('MailOfficePreviewTeaser', () => {
  it('shows "Просмотреть" on hover and opens full preview', () => {
    const onOpenFull = vi.fn();
    const { container } = renderWithTheme(
      <MailOfficePreviewTeaser onOpenFull={onOpenFull}>
        <div>preview body</div>
      </MailOfficePreviewTeaser>,
    );

    expect(screen.getByText('preview body')).toBeTruthy();
    fireEvent.mouseEnter(container.firstChild);
    fireEvent.click(screen.getByRole('button', { name: 'Просмотреть' }));
    expect(onOpenFull).toHaveBeenCalledTimes(1);
  });
});
