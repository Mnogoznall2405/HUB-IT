import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// FE-0232 (second path): on the wide layout the still-open editor is reseeded
// from the PATCH response, which has no task_delegate_links. Without the
// preservation fix the next save writes [] over real delegate links.

vi.mock('./UserDraftFields', () => ({ default: () => null }));
vi.mock('../../../contexts/NotificationContext', () => ({ useNotification: () => ({ notifyWarning: vi.fn() }) }));

import UsersTab from './UsersTab';

const LINK = { delegate_user_id: '12', role_type: 'assistant', is_active: true };
const LINK_SHAPE = expect.objectContaining({ delegate_user_id: '12', role_type: 'assistant' });
const USER_WITH_LINKS = {
  id: 11,
  username: 'owner',
  role: 'viewer',
  is_active: true,
  auth_source: 'local',
  task_delegate_links: [LINK],
};

function renderTab(onUpdateUser) {
  return render(
    <MemoryRouter>
      <UsersTab
        currentUserId={1}
        isAdmin
        users={[USER_WITH_LINKS]}
        sessions={[]}
        dbOptions={[]}
        loading={false}
        savingUser={false}
        onCreateUser={vi.fn()}
        onUpdateUser={onUpdateUser}
        onDeleteUser={vi.fn()}
        isVeryWide
      />
    </MemoryRouter>,
  );
}

describe('UsersTab delegate reseed (FE-0232)', () => {
  it('keeps task_delegate_links in the still-open editor after a successful save', async () => {
    const onUpdateUser = vi.fn().mockResolvedValue({ ok: true, user: { ...USER_WITH_LINKS, task_delegate_links: undefined } });
    renderTab(onUpdateUser);

    await act(async () => {
      (await screen.findByText('owner')).closest('tr').click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Сохранить' }).click();
    });

    await waitFor(() => {
      expect(onUpdateUser).toHaveBeenCalledTimes(1);
    });
    expect(onUpdateUser.mock.calls[0][0].task_delegate_links).toEqual([LINK_SHAPE]);

    // Second save of the still-open editor must not send the empty default.
    await act(async () => {
      screen.getByRole('button', { name: 'Сохранить' }).click();
    });
    await waitFor(() => {
      expect(onUpdateUser).toHaveBeenCalledTimes(2);
    });
    expect(onUpdateUser.mock.calls[1][0].task_delegate_links).toEqual([LINK_SHAPE]);
  });
});
