import React, { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatGroupDialog from './useChatGroupDialog';

vi.mock('../../api/client', () => ({
  chatAPI: {
    createGroupConversation: vi.fn(),
    getUsers: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

function Harness({
  loadConversations = vi.fn().mockResolvedValue([{ id: 'conv-created' }]),
  openMobileThreadView = vi.fn(),
  setActiveConversationId = vi.fn(),
}) {
  const loadConversationsRef = useRef(loadConversations);
  const openMobileThreadViewRef = useRef(openMobileThreadView);
  const group = useChatGroupDialog({
    isMobile: true,
    loadChatDialogsModule: vi.fn(),
    loadConversationsRef,
    notifyApiError: vi.fn(),
    notifySuccess: vi.fn(),
    openMobileThreadViewRef,
    searchDebounceMs: 0,
    setActiveConversationId,
  });

  return (
    <>
      <button type="button" onClick={group.openGroupDialog}>open</button>
      <input
        aria-label="title"
        value={group.groupTitle}
        onChange={(event) => group.setGroupTitle(event.target.value)}
      />
      <input
        aria-label="search"
        value={group.groupSearch}
        onChange={(event) => group.setGroupSearch(event.target.value)}
      />
      <button type="button" onClick={() => group.addGroupMember({ id: 2, full_name: 'Beta' })}>add beta</button>
      <button type="button" onClick={() => group.addGroupMember({ id: 1, full_name: 'Alpha' })}>add alpha</button>
      <button type="button" onClick={() => group.removeGroupMember(2)}>remove beta</button>
      <button type="button" disabled={group.groupCreateDisabled} onClick={group.createGroup}>create</button>
      <button type="button" onClick={group.closeGroupDialog}>close</button>
      <div data-testid="open">{String(group.groupOpen)}</div>
      <div data-testid="members">{group.groupMemberIds.join(',')}</div>
      <div data-testid="users">{group.groupUsers.map((item) => item.full_name).join(',')}</div>
    </>
  );
}

describe('useChatGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads users, manages members, and creates a group conversation', async () => {
    const loadConversations = vi.fn().mockResolvedValue([{ id: 'conv-created' }]);
    const openMobileThreadView = vi.fn();
    const setActiveConversationId = vi.fn();
    chatAPI.getUsers
      .mockResolvedValueOnce({ items: [{ id: 1, full_name: 'Alpha' }] })
      .mockResolvedValueOnce({ items: [{ id: 2, full_name: 'Beta' }] });
    chatAPI.createGroupConversation.mockResolvedValueOnce({ id: 'conv-created' });

    render(
      <Harness
        loadConversations={loadConversations}
        openMobileThreadView={openMobileThreadView}
        setActiveConversationId={setActiveConversationId}
      />,
    );

    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenCalledWith({ q: '', limit: 100 }));
    expect(screen.getByTestId('open')).toHaveTextContent('true');

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'be' } });
    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenLastCalledWith({ q: 'be', limit: 100 }));

    fireEvent.click(screen.getByText('add beta'));
    fireEvent.click(screen.getByText('add alpha'));
    expect(screen.getByTestId('members')).toHaveTextContent('2,1');

    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Ops' } });
    fireEvent.click(screen.getByText('create'));

    await waitFor(() => expect(chatAPI.createGroupConversation).toHaveBeenCalledWith({
      title: 'Ops',
      member_user_ids: [2, 1],
    }));
    expect(loadConversations).toHaveBeenCalledWith({ silent: true, force: true });
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-created');
    expect(openMobileThreadView).toHaveBeenCalledWith('conv-created');
  });

  it('does not close while a group is being created', async () => {
    let resolveCreate;
    chatAPI.getUsers.mockResolvedValue({ items: [] });
    chatAPI.createGroupConversation.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    render(<Harness />);

    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('add beta'));
    fireEvent.click(screen.getByText('add alpha'));
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'Ops' } });
    fireEvent.click(screen.getByText('create'));
    fireEvent.click(screen.getByText('close'));

    expect(screen.getByTestId('open')).toHaveTextContent('true');
    resolveCreate({ id: 'conv-created' });
    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
  });
});
