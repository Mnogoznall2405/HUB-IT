import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RootErrorBoundary from './RootErrorBoundary';

describe('RootErrorBoundary', () => {
  it('shows a plain-DOM fallback instead of an empty root and reloads on demand', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    function Broken() {
      throw new Error('bootstrap exploded');
    }
    render(
      <RootErrorBoundary>
        <Broken />
      </RootErrorBoundary>,
    );

    expect(screen.getByText('HUB-IT не удалось запустить')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(reload).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('renders children while nothing throws', () => {
    render(
      <RootErrorBoundary>
        <div>app content</div>
      </RootErrorBoundary>,
    );
    expect(screen.getByText('app content')).toBeInTheDocument();
  });
});
