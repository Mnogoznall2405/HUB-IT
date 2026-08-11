import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import FeedSidebar from './FeedSidebar';

const renderSidebar = (props = {}, mode = 'light') => render(
  <ThemeProvider theme={createTheme({ palette: { mode } })}>
    <FeedSidebar
      activeFilter="all"
      onFilterChange={vi.fn()}
      query=""
      onQueryChange={vi.fn()}
      total={18}
      unreadTotal={4}
      {...props}
    />
  </ThemeProvider>,
);

describe('FeedSidebar', () => {
  it('shows feed counters and changes the active section', () => {
    const onFilterChange = vi.fn();
    renderSidebar({ onFilterChange });

    expect(screen.getByRole('button', { name: /Все публикации 18/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Новое для меня 4/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Важные новости/i }));
    expect(onFilterChange).toHaveBeenCalledWith('important');
  });

  it('updates search and renders safely in the dark theme', () => {
    const onQueryChange = vi.fn();
    renderSidebar({ onQueryChange }, 'dark');

    fireEvent.change(screen.getByLabelText('Поиск в ленте'), { target: { value: 'релиз' } });
    expect(onQueryChange).toHaveBeenCalledWith('релиз');
  });
});
