import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  watchTaskPresence: vi.fn(),
}));

vi.mock('../../../lib/hubRealtimeSocket', () => ({
  hubRealtimeSocket: {
    watchTaskPresence: (...args) => mocks.watchTaskPresence(...args),
  },
  HUB_REALTIME_TASK_PRESENCE_EVENT: 'hub-realtime-task-presence',
}));

import TaskPresenceIndicator from './TaskPresenceIndicator';

const dispatchPresence = (type, collaborator, connectionId) => {
  window.dispatchEvent(new CustomEvent('hub-realtime-task-presence', {
    detail: {
      type,
      payload: {
        task_id: 'task-7',
        connection_id: connectionId,
        collaborator,
      },
    },
  }));
};

describe('TaskPresenceIndicator', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows accessible collaborators and deduplicates their connections', async () => {
    mocks.watchTaskPresence.mockReturnValue(mocks.release);
    const view = render(<TaskPresenceIndicator taskId="task-7" />);

    expect(mocks.watchTaskPresence).toHaveBeenCalledWith('task-7');
    act(() => {
      dispatchPresence('tasks.presence.joined', { id: 2, full_name: 'Пётр Петров' }, 'peer-1');
      dispatchPresence('tasks.presence.present', { id: 2, full_name: 'Пётр Петров' }, 'peer-2');
    });

    expect(await screen.findByRole('status', { name: 'Пётр Петров сейчас смотрит задачу' })).toBeInTheDocument();
    expect(screen.getByText('Пётр Петров смотрит задачу')).toBeInTheDocument();

    view.unmount();
    await waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(1));
  });
});
