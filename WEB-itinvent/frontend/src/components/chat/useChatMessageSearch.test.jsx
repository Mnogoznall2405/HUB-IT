import React, { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatMessageSearch from './useChatMessageSearch';

vi.mock('../../api/client', () => ({
  chatAPI: {
    searchMessages: vi.fn(),
  },
}));

function Harness({ revealMessage = vi.fn().mockResolvedValue(true) }) {
  const activeConversationIdRef = useRef('conv-1');
  const revealMessageRef = useRef(revealMessage);
  const search = useChatMessageSearch({
    activeConversationId: 'conv-1',
    activeConversationIdRef,
    loadChatDialogsModule: vi.fn(),
    notifyApiError: vi.fn(),
    notifyInfo: vi.fn(),
    revealMessageRef,
    searchDebounceMs: 0,
    setMessageMenuAnchor: vi.fn(),
    setMessageMenuMessage: vi.fn(),
    setThreadMenuAnchor: vi.fn(),
  });

  return (
    <>
      <button type="button" onClick={search.openSearchDialog}>open</button>
      <input
        aria-label="search"
        value={search.messageSearch}
        onChange={(event) => search.setMessageSearch(event.target.value)}
      />
      <button type="button" onClick={search.loadMoreSearchResults}>more</button>
      <button type="button" onClick={search.resetMessageSearch}>reset</button>
      <div data-testid="open">{String(search.searchOpen)}</div>
      <div data-testid="count">{search.messageSearchResults.length}</div>
      {search.messageSearchResults.map((item) => (
        <button key={item.id} type="button" onClick={() => search.openSearchResult(item)}>
          {item.body}
        </button>
      ))}
    </>
  );
}

describe('useChatMessageSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('debounces search, paginates from the last result, and opens found messages', async () => {
    const revealMessage = vi.fn().mockResolvedValue(true);
    chatAPI.searchMessages
      .mockResolvedValueOnce({ items: [{ id: 'msg-1', body: 'first' }], has_more: true })
      .mockResolvedValueOnce({ items: [{ id: 'msg-0', body: 'older' }], has_more: false });

    render(<Harness revealMessage={revealMessage} />);

    fireEvent.click(screen.getByText('open'));
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'disk' } });

    await waitFor(() => expect(chatAPI.searchMessages).toHaveBeenCalledWith('conv-1', {
      q: 'disk',
      limit: 20,
      before_message_id: undefined,
    }));
    expect(screen.getByTestId('count')).toHaveTextContent('1');

    fireEvent.click(screen.getByText('more'));
    await waitFor(() => expect(chatAPI.searchMessages).toHaveBeenLastCalledWith('conv-1', {
      q: 'disk',
      limit: 20,
      before_message_id: 'msg-1',
    }));

    fireEvent.click(screen.getByText('first'));
    await waitFor(() => expect(revealMessage).toHaveBeenCalledWith('msg-1'));
    expect(screen.getByTestId('open')).toHaveTextContent('false');
  });

  it('resets search state without touching the rest of Chat.jsx', async () => {
    chatAPI.searchMessages.mockResolvedValueOnce({ items: [{ id: 'msg-1', body: 'first' }], has_more: false });

    render(<Harness />);

    fireEvent.click(screen.getByText('open'));
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'disk' } });
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    fireEvent.click(screen.getByText('reset'));

    expect(screen.getByTestId('open')).toHaveTextContent('false');
    expect(screen.getByLabelText('search')).toHaveValue('');
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
