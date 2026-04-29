import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatTaskShareDialog from './useChatTaskShareDialog';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getShareableTasks: vi.fn(),
  },
}));

function Harness({ notifyApiError = vi.fn() }) {
  const share = useChatTaskShareDialog({
    activeConversationId: 'conv-1',
    loadChatDialogsModule: vi.fn(),
    notifyApiError,
    searchDebounceMs: 0,
    setComposerMenuAnchor: vi.fn(),
    setMessageMenuAnchor: vi.fn(),
    setMessageMenuMessage: vi.fn(),
    setThreadMenuAnchor: vi.fn(),
  });

  return (
    <>
      <button type="button" onClick={share.openShareDialog}>open</button>
      <input
        aria-label="task search"
        value={share.taskSearch}
        onChange={(event) => share.setTaskSearch(event.target.value)}
      />
      <button type="button" onClick={share.resetShareDialog}>reset</button>
      <div data-testid="open">{String(share.shareOpen)}</div>
      <div data-testid="tasks">{share.shareableTasks.map((item) => item.title).join(',')}</div>
    </>
  );
}

describe('useChatTaskShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens, searches shareable tasks, and resets state', async () => {
    chatAPI.getShareableTasks.mockImplementation((_conversationId, params = {}) => (
      Promise.resolve({
        items: String(params?.q || '').trim() === 'repair'
          ? [{ id: 'task-2', title: 'Repair' }]
          : [{ id: 'task-1', title: 'Inventory' }],
      })
    ));

    render(<Harness />);

    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(chatAPI.getShareableTasks).toHaveBeenCalledWith('conv-1', {
      q: '',
      limit: 50,
    }));
    expect(screen.getByTestId('open')).toHaveTextContent('true');
    expect(screen.getByTestId('tasks')).toHaveTextContent('Inventory');

    fireEvent.change(screen.getByLabelText('task search'), { target: { value: 'repair' } });
    await waitFor(() => expect(chatAPI.getShareableTasks).toHaveBeenLastCalledWith('conv-1', {
      q: 'repair',
      limit: 50,
    }));

    fireEvent.click(screen.getByText('reset'));
    expect(screen.getByTestId('open')).toHaveTextContent('false');
    expect(screen.getByLabelText('task search')).toHaveValue('');
    expect(screen.getByTestId('tasks')).toHaveTextContent('');
  });

  it('reports task loading failures and clears stale results', async () => {
    const notifyApiError = vi.fn();
    chatAPI.getShareableTasks.mockRejectedValueOnce(new Error('failed'));

    render(<Harness notifyApiError={notifyApiError} />);

    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(notifyApiError).toHaveBeenCalledWith(
      expect.any(Error),
      'Не удалось загрузить задачи, доступные для отправки в этот чат.',
    ));
    expect(screen.getByTestId('tasks')).toHaveTextContent('');
  });
});
