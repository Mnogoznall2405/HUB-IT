import React, { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { getChatConfigCached } from '../../api/chatConfig';
import useChatGroupDialog, { resetChatGroupUsersCache } from './useChatGroupDialog';

vi.mock('../../api/client', () => ({
  chatAPI: {
    createGroupConversation: vi.fn(),
    getUsers: vi.fn(),
    uploadGroupAvatar: vi.fn(),
  },
}));

vi.mock('../../api/chatConfig', () => ({
  getChatConfigCached: vi.fn(),
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

function Harness({
  isMobile = true,
  loadConversations = vi.fn().mockResolvedValue([{ id: 'conv-created' }]),
  notifyApiError = vi.fn(),
  notifyInfo = vi.fn(),
  openMobileThreadView = vi.fn(),
  setActiveConversationId = vi.fn(),
}) {
  const loadConversationsRef = useRef(loadConversations);
  const openMobileThreadViewRef = useRef(openMobileThreadView);
  const group = useChatGroupDialog({
    isMobile,
    loadConversationsRef,
    notifyApiError,
    notifyInfo,
    openMobileThreadViewRef,
    searchDebounceMs: 0,
    setActiveConversationId,
  });

  return (
    <>
      <button type="button" onClick={group.openGroupDialog}>open</button>
      <button type="button" onClick={group.openDirectFlow}>open-direct</button>
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
      <button type="button" onClick={() => group.addGroupMember({ id: 3, full_name: 'Gamma' })}>add gamma</button>
      <button type="button" onClick={() => group.removeGroupMember(2)}>remove beta</button>
      <button type="button" disabled={group.groupCreateDisabled} onClick={group.createGroup}>create</button>
      <button type="button" onClick={group.closeComposeFlow}>close</button>
      <button type="button" onClick={() => group.setGroupStep('details')}>to details</button>
      <div data-testid="flow">{group.composeFlow || 'none'}</div>
      <div data-testid="step">{group.groupStep}</div>
      <div data-testid="limit">{String(group.groupSelectableLimit)}</div>
      <div data-testid="members">{group.groupMemberIds.join(',')}</div>
      <div data-testid="users">{group.groupUsers.map((item) => item.full_name).join(',')}</div>
    </>
  );
}

describe('useChatGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChatGroupUsersCache();
    chatAPI.getUsers.mockResolvedValue({ items: [] });
    getChatConfigCached.mockResolvedValue({ group_max_members: 128 });
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
    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenCalledWith({ q: '', limit: 200 }));
    expect(screen.getByTestId('flow')).toHaveTextContent('group');

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'be' } });
    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenLastCalledWith({ q: 'be', limit: 200 }));

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

    expect(screen.getByTestId('flow')).toHaveTextContent('group');
    resolveCreate({ id: 'conv-created' });
    await waitFor(() => expect(screen.getByTestId('flow')).toHaveTextContent('none'));
  });

  it('requests the chat config on mount and exposes the creator-aware limit', async () => {
    getChatConfigCached.mockResolvedValue({ group_max_members: 3 });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('limit')).toHaveTextContent('2'));
    expect(getChatConfigCached).toHaveBeenCalled();
  });

  it('retries the config request after a failure', async () => {
    getChatConfigCached
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ group_max_members: 4 });

    render(<Harness />);

    await waitFor(() => expect(getChatConfigCached).toHaveBeenCalledTimes(1));
    // Д2-9: при ошибке конфига действует fallback 128 → из каталога
    // можно выбрать 127 (создатель уже входит в лимит backend).
    expect(screen.getByTestId('limit')).toHaveTextContent('127');

    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(screen.getByTestId('limit')).toHaveTextContent('3'));
    expect(getChatConfigCached).toHaveBeenCalledTimes(2);
  });

  it('caps selectable members at group_max_members - 1 (creator included by backend)', async () => {
    getChatConfigCached.mockResolvedValue({ group_max_members: 3 });

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('limit')).toHaveTextContent('2'));

    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByText('add beta'));
    fireEvent.click(screen.getByText('add alpha'));
    fireEvent.click(screen.getByText('add gamma'));

    expect(screen.getByTestId('members')).toHaveTextContent('2,1');
    expect(screen.getByTestId('members')).not.toHaveTextContent('3');
  });

  it('supports the direct-message compose mode and the two-step group flow', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('open-direct'));
    expect(screen.getByTestId('flow')).toHaveTextContent('direct');
    await waitFor(() => expect(chatAPI.getUsers).toHaveBeenCalled());

    fireEvent.click(screen.getByText('close'));
    expect(screen.getByTestId('flow')).toHaveTextContent('none');

    fireEvent.click(screen.getByText('open'));
    expect(screen.getByTestId('flow')).toHaveTextContent('group');
    expect(screen.getByTestId('step')).toHaveTextContent('members');

    fireEvent.click(screen.getByText('to details'));
    expect(screen.getByTestId('step')).toHaveTextContent('details');

    fireEvent.click(screen.getByText('close'));
    expect(screen.getByTestId('step')).toHaveTextContent('members');
    expect(screen.getByTestId('flow')).toHaveTextContent('none');
  });
});
