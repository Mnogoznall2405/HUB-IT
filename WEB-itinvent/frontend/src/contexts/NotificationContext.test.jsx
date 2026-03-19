import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotification } from './NotificationContext';

function TestHarness({ onAction = vi.fn() }) {
  const {
    notifySuccess,
    notifyInfo,
    notifyWarning,
  } = useNotification();

  return (
    <div>
      <button type="button" onClick={() => notifySuccess('Операция завершена', { title: 'Готово', durationMs: 1000 })}>
        success
      </button>
      <button type="button" onClick={() => notifyInfo('Постоянное уведомление', { persist: true })}>
        persist
      </button>
      <button
        type="button"
        onClick={() => notifyWarning('Повторяемое уведомление', {
          title: 'Внимание',
          durationMs: 1000,
          dedupeMode: 'recent',
          dedupeKey: 'duplicate-warning',
        })}
      >
        duplicate
      </button>
      <button
        type="button"
        onClick={() => notifyInfo('Доступно действие', {
          title: 'Переход',
          durationMs: 1500,
          actionLabel: 'Открыть',
          onAction,
        })}
      >
        action
      </button>
      <button
        type="button"
        onClick={() => notifyInfo('Открыть раздел настроек', {
          title: 'Настройки',
          durationMs: 1500,
          action: { kind: 'navigate', label: 'Перейти', to: '/settings' },
        })}
      >
        action-serialized
      </button>
    </div>
  );
}

function renderNotifications(options = {}) {
  const onAction = options.onAction || vi.fn();
  render(
    <NotificationProvider>
      <TestHarness onAction={onAction} />
    </NotificationProvider>,
  );
  return { onAction };
}

describe('NotificationProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders stacked toasts in the bottom-left viewport with a progress bar', async () => {
    renderNotifications();

    fireEvent.click(screen.getByRole('button', { name: 'success' }));

    expect(screen.getByTestId('toast-stack')).toHaveAttribute('data-toast-position', 'bottom-left');
    expect(await screen.findByText('Готово')).toBeInTheDocument();
    expect(screen.getByText('Операция завершена')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('pauses auto-close while the toast is hovered', () => {
    vi.useFakeTimers();
    renderNotifications();

    fireEvent.click(screen.getByRole('button', { name: 'success' }));

    const toast = screen.getByTestId('toast-viewport');

    act(() => {
      vi.advanceTimersByTime(400);
    });

    fireEvent.mouseEnter(toast);

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.getByText('Операция завершена')).toBeInTheDocument();

    fireEvent.mouseLeave(toast);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText('Операция завершена')).not.toBeInTheDocument();
  }, 10000);

  it('dedupes recent toasts and increments repeat count', async () => {
    renderNotifications();

    fireEvent.click(screen.getByRole('button', { name: 'duplicate' }));
    fireEvent.click(screen.getByRole('button', { name: 'duplicate' }));

    expect(await screen.findByText('Внимание')).toBeInTheDocument();
    expect(screen.getAllByTestId('toast-viewport')).toHaveLength(1);
    expect(screen.getByText('x2')).toBeInTheDocument();
  });

  it('hides the progress bar for persistent toasts and supports action callbacks', async () => {
    const { onAction } = renderNotifications();

    fireEvent.click(screen.getByRole('button', { name: 'persist' }));
    expect(await screen.findAllByText('Постоянное уведомление')).toHaveLength(2);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'action' }));
    const actionToast = await screen.findByText('Доступно действие');
    expect(actionToast).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Открыть' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('Доступно действие')).not.toBeInTheDocument();
    });
  });

  it('supports serializable toast actions without runtime callbacks', async () => {
    const actionListener = vi.fn();
    window.addEventListener('itinvent:toast-action-execute', actionListener);
    renderNotifications();

    fireEvent.click(screen.getByRole('button', { name: 'action-serialized' }));

    expect(await screen.findByText('Открыть раздел настроек')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Перейти' }));

    expect(actionListener).toHaveBeenCalledTimes(1);
    expect(actionListener.mock.calls[0][0]?.detail).toMatchObject({
      kind: 'navigate',
      to: '/settings',
    });

    window.removeEventListener('itinvent:toast-action-execute', actionListener);
  });
});
