import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ToastHistoryList from './ToastHistoryList';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderHistory(items, initialPath = '/start') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="*"
          element={(
            <>
              <LocationProbe />
              <ToastHistoryList items={items} />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ToastHistoryList', () => {
  it('renders explicit navigate action and opens it from the action button', () => {
    renderHistory([
      {
        id: 'task-toast',
        severity: 'info',
        source: 'tasks',
        title: 'Новая задача',
        message: 'Открыть карточку задачи',
        lastSeenAt: '2026-03-18T08:00:00Z',
        action: { kind: 'navigate', label: 'Открыть задачу', to: '/tasks' },
      },
    ]);

    expect(screen.getByRole('button', { name: 'Открыть задачу' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть задачу' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/tasks');
  });

  it('uses source fallback action when explicit action is absent', () => {
    renderHistory([
      {
        id: 'settings-toast',
        severity: 'success',
        source: 'settings',
        title: 'Пользователь обновлён',
        message: 'Открыть настройки',
        lastSeenAt: '2026-03-18T08:05:00Z',
      },
    ]);

    expect(screen.getByRole('button', { name: 'Открыть раздел' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('toast-history-settings-toast'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/settings');
  });

  it('keeps unknown sources passive', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderHistory([
      {
        id: 'passive-toast',
        severity: 'warning',
        source: 'system',
        title: 'Системное сообщение',
        message: 'Без быстрого действия',
        lastSeenAt: '2026-03-18T08:10:00Z',
      },
    ]);

    expect(screen.queryByRole('button', { name: 'Открыть раздел' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('toast-history-passive-toast'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/start');
    expect(openSpy).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });
});
