import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatGroupsAdminSection } from './ChatGroupsAdminSection';

const apiMock = vi.hoisted(() => ({
  listOwnerlessGroups: vi.fn(),
  getGroupStructure: vi.fn(),
  listGroupAudit: vi.fn(),
  assignGroupOwner: vi.fn(),
  removeGroupMember: vi.fn(),
  autoAssignOwners: vi.fn(),
}));

vi.mock('../../../api/chatGroupAdmin', () => ({ chatGroupAdminAPI: apiMock }));
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotification: () => ({ notifyApiError: vi.fn(), notifySuccess: vi.fn() }),
}));
vi.mock('../../../components/feedback/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

const structure = {
  id: 'g1',
  title: 'ИТ-отдел',
  member_count: 2,
  owner_user_id: 1,
  owner_active: false,
  members: [
    { user_id: 1, full_name: 'Уволенный Владелец', member_role: 'owner', is_active: false },
    { user_id: 2, full_name: 'Анна Участница', member_role: 'member', is_active: true },
  ],
};

describe('ChatGroupsAdminSection', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockReset());
    apiMock.listOwnerlessGroups.mockResolvedValue({ items: [{ id: 'g1', title: 'ИТ-отдел', owner_user_ids: [1] }] });
    apiMock.getGroupStructure.mockResolvedValue(structure);
    apiMock.listGroupAudit.mockResolvedValue({ items: [] });
    apiMock.assignGroupOwner.mockResolvedValue({});
  });

  it('lets an admin hand an ownerless group to an active member', async () => {
    render(<ChatGroupsAdminSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть состав' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить владельцем' }));

    await waitFor(() => expect(apiMock.assignGroupOwner).toHaveBeenCalledWith('g1', 2));
    // The deactivated owner cannot be picked as the new owner.
    expect(screen.queryAllByRole('button', { name: 'Назначить владельцем' })).toHaveLength(1);
  });

  it('previews the automatic owner and applies it only when the server flag is on', async () => {
    const plan = [{ conversation_id: 'g1', title: 'ИТ-отдел', successor_user_id: 2, successor_name: 'Анна Участница' }];
    apiMock.autoAssignOwners
      .mockResolvedValueOnce({ dry_run: true, enabled: true, planned: plan, assigned: 0 })
      .mockResolvedValueOnce({ dry_run: false, enabled: true, planned: plan, assigned: 1 });
    render(<ChatGroupsAdminSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Проверить автоназначение' }));
    expect(await screen.findByText(/Анна Участница/)).toBeInTheDocument();
    expect(apiMock.autoAssignOwners).toHaveBeenCalledWith({ dryRun: true });

    fireEvent.click(screen.getByRole('button', { name: 'Назначить автоматически' }));
    await waitFor(() => expect(apiMock.autoAssignOwners).toHaveBeenLastCalledWith({ dryRun: false }));
  });

  it('explains that automatic assignment is switched off instead of offering it', async () => {
    apiMock.autoAssignOwners.mockResolvedValue({ dry_run: true, enabled: false, planned: [], assigned: 0 });
    render(<ChatGroupsAdminSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Проверить автоназначение' }));
    expect(await screen.findByText(/CHAT_GROUP_AUTO_OWNER_ENABLED/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назначить автоматически' })).not.toBeInTheDocument();
  });
});
