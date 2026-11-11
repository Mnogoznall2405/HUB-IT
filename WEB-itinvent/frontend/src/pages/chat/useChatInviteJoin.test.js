import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useChatInviteJoin from './useChatInviteJoin';

const apiMock = vi.hoisted(() => ({
  previewGroupInvite: vi.fn(),
  joinGroupByInvite: vi.fn(),
  getConversation: vi.fn(),
}));

vi.mock('../../api/client', () => ({ chatAPI: apiMock }));

const baseProps = () => ({
  locationPathname: '/chat',
  locationSearch: '?join=tok-1&conversation=old',
  navigate: vi.fn(),
  confirmDialog: vi.fn().mockResolvedValue(true),
  notifyApiError: vi.fn(),
  notifyInfo: vi.fn(),
  onJoined: vi.fn(),
});

describe('useChatInviteJoin', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockReset());
  });

  it('drops the token from the URL, asks once, joins and opens the conversation', async () => {
    apiMock.previewGroupInvite.mockResolvedValue({ title: 'ИТ-отдел', member_count: 7, already_member: false });
    apiMock.joinGroupByInvite.mockResolvedValue({ joined: true, conversation: { id: 'g-1', kind: 'group' } });
    const props = baseProps();

    renderHook(() => useChatInviteJoin(props));

    expect(props.navigate).toHaveBeenCalledWith('/chat?conversation=old', { replace: true });
    await waitFor(() => expect(props.onJoined).toHaveBeenCalledWith({ id: 'g-1', kind: 'group' }));
    expect(apiMock.previewGroupInvite).toHaveBeenCalledWith('tok-1');
    expect(props.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Вступить' }));
    expect(apiMock.joinGroupByInvite).toHaveBeenCalledWith('tok-1');
  });

  it('does not join when the person declines', async () => {
    apiMock.previewGroupInvite.mockResolvedValue({ title: 'ИТ-отдел', member_count: 7, already_member: false });
    const props = { ...baseProps(), confirmDialog: vi.fn().mockResolvedValue(false) };

    renderHook(() => useChatInviteJoin(props));

    await waitFor(() => expect(props.confirmDialog).toHaveBeenCalled());
    expect(apiMock.joinGroupByInvite).not.toHaveBeenCalled();
    expect(props.onJoined).not.toHaveBeenCalled();
  });

  it('opens the group directly for an existing member without asking', async () => {
    apiMock.previewGroupInvite.mockResolvedValue({ already_member: true, conversation_id: 'g-9' });
    apiMock.getConversation.mockResolvedValue({ id: 'g-9', kind: 'group' });
    const props = baseProps();

    renderHook(() => useChatInviteJoin(props));

    await waitFor(() => expect(props.onJoined).toHaveBeenCalledWith({ id: 'g-9', kind: 'group' }));
    expect(props.confirmDialog).not.toHaveBeenCalled();
    expect(apiMock.joinGroupByInvite).not.toHaveBeenCalled();
  });

  it('reports an invalid link', async () => {
    apiMock.previewGroupInvite.mockRejectedValue(new Error('404'));
    const props = baseProps();

    renderHook(() => useChatInviteJoin(props));

    await waitFor(() => expect(props.notifyApiError).toHaveBeenCalled());
    expect(props.onJoined).not.toHaveBeenCalled();
  });
});
