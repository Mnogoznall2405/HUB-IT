import React, { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatSidebarSearch from './useChatSidebarSearch';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getConversations: vi.fn(),
    getUsers: vi.fn(),
  },
}));

function Harness({ notifyApiError }) {
  const notifyApiErrorRef = useRef(notifyApiError || vi.fn());
  const sidebarSearch = useChatSidebarSearch({
    notifyApiError: notifyApiErrorRef.current,
    searchDebounceMs: 0,
  });

  return (
    <>
      <input
        aria-label="sidebar search"
        value={sidebarSearch.sidebarQuery}
        onChange={(event) => sidebarSearch.setSidebarQuery(event.target.value)}
      />
      <button type="button" onClick={sidebarSearch.resetSidebarSearch}>reset</button>
      <button
        type="button"
        onClick={() => sidebarSearch.upsertSearchConversation({ id: 'conv-1', title: 'Updated' })}
      >
        patch chat
      </button>
      <button
        type="button"
        onClick={() => sidebarSearch.patchSearchPersonPresence(1, { status: 'online' })}
      >
        patch person
      </button>
      <div data-testid="active">{String(sidebarSearch.sidebarSearchActive)}</div>
      <div data-testid="empty">{String(sidebarSearch.searchResultEmpty)}</div>
      <div data-testid="loading">{String(sidebarSearch.searchingSidebar)}</div>
      <div data-testid="people">{sidebarSearch.searchPeople.map((item) => `${item.full_name}:${item.presence?.status || ''}`).join(',')}</div>
      <div data-testid="chats">{sidebarSearch.searchChats.map((item) => item.title).join(',')}</div>
    </>
  );
}

describe('useChatSidebarSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches people and conversations, then resets results', async () => {
    chatAPI.getUsers.mockResolvedValueOnce({
      items: [
        { id: 2, full_name: 'Beta' },
        { id: 1, full_name: 'Alpha' },
      ],
    });
    chatAPI.getConversations.mockResolvedValueOnce({
      items: [{ id: 'conv-1', title: 'Ops' }],
    });

    render(<Harness />);

    fireEvent.change(screen.getByLabelText('sidebar search'), { target: { value: 'ops' } });

    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenCalledWith({ q: 'ops', limit: 12 }));
    expect(chatAPI.getConversations).toHaveBeenCalledWith({ q: 'ops', limit: 20 });
    expect(screen.getByTestId('people')).toHaveTextContent('Alpha:,Beta:');
    expect(screen.getByTestId('chats')).toHaveTextContent('Ops');

    fireEvent.click(screen.getByText('patch chat'));
    expect(screen.getByTestId('chats')).toHaveTextContent('Updated');

    fireEvent.click(screen.getByText('patch person'));
    expect(screen.getByTestId('people')).toHaveTextContent('Alpha:online,Beta:');

    fireEvent.click(screen.getByText('reset'));
    expect(screen.getByLabelText('sidebar search')).toHaveValue('');
    expect(screen.getByTestId('people')).toHaveTextContent('');
    expect(screen.getByTestId('chats')).toHaveTextContent('');
  });

  it('ignores stale search responses after the query changes', async () => {
    let resolveOldUsers;
    let resolveOldConversations;
    chatAPI.getUsers
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOldUsers = resolve;
      }))
      .mockResolvedValueOnce({ items: [{ id: 2, full_name: 'New User' }] });
    chatAPI.getConversations
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOldConversations = resolve;
      }))
      .mockResolvedValueOnce({ items: [{ id: 'conv-new', title: 'New Chat' }] });

    render(<Harness />);

    fireEvent.change(screen.getByLabelText('sidebar search'), { target: { value: 'old' } });
    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenCalledWith({ q: 'old', limit: 12 }));

    fireEvent.change(screen.getByLabelText('sidebar search'), { target: { value: 'new' } });
    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenCalledWith({ q: 'new', limit: 12 }));

    resolveOldUsers({ items: [{ id: 1, full_name: 'Old User' }] });
    resolveOldConversations({ items: [{ id: 'conv-old', title: 'Old Chat' }] });

    await waitFor(() => expect(screen.getByTestId('people')).toHaveTextContent('New User'));
    expect(screen.getByTestId('chats')).toHaveTextContent('New Chat');
    expect(screen.getByTestId('people')).not.toHaveTextContent('Old User');
    expect(screen.getByTestId('chats')).not.toHaveTextContent('Old Chat');
  });

  it('reports failures and clears stale sidebar search state', async () => {
    const notifyApiError = vi.fn();
    chatAPI.getUsers.mockRejectedValueOnce(new Error('failed'));
    chatAPI.getConversations.mockResolvedValueOnce({ items: [] });

    render(<Harness notifyApiError={notifyApiError} />);

    fireEvent.change(screen.getByLabelText('sidebar search'), { target: { value: 'ops' } });

    await waitFor(() => expect(notifyApiError).toHaveBeenCalledWith(
      expect.any(Error),
      'Не удалось выполнить поиск по людям и чатам.',
    ));
    expect(screen.getByTestId('people')).toHaveTextContent('');
    expect(screen.getByTestId('chats')).toHaveTextContent('');
  });
});
