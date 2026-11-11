import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import FeedQuickComposer from './FeedQuickComposer';

describe('FeedQuickComposer', () => {
  it('opens the publication form from the social composer prompt', () => {
    const onCreate = vi.fn();
    render(
      <ThemeProvider theme={createTheme()}>
        <FeedQuickComposer user={{ full_name: 'Иван Петров' }} onCreate={onCreate} />
      </ThemeProvider>,
    );

    expect(screen.getByText('ИП')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Что происходит в компании/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
