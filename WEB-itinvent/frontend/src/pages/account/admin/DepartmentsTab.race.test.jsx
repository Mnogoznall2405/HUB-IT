import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// FE-0239: a late members response for a previously selected department must
// not overwrite the manager draft of the currently selected one, and a save
// must never write one department's draft into another department.

const {
  mockList,
  mockGetMembers,
  mockSetManagers,
  mockSyncFromAD,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGetMembers: vi.fn(),
  mockSetManagers: vi.fn(),
  mockSyncFromAD: vi.fn(),
}));

vi.mock('../../../api/departments', () => ({
  departmentsAPI: {
    list: mockList,
    getMembers: mockGetMembers,
    setManagers: mockSetManagers,
    syncFromAD: mockSyncFromAD,
  },
}));

import DepartmentsTab from './DepartmentsTab';

const DEPTS = [
  { id: 1, name: 'Отдел D1', members_count: 1, managers_count: 1, source: 'manual' },
  { id: 2, name: 'Отдел D2', members_count: 1, managers_count: 1, source: 'manual' },
];
const member = (userId, role = 'member') => ({
  user_id: userId,
  role,
  is_active: true,
  user: { username: `u${userId}`, full_name: `Пользователь ${userId}` },
});

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function selectDepartment(name) {
  const select = document.querySelector('.MuiSelect-select');
  if (!select) throw new Error('department select not found');
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByRole('option', { name }));
}

const saveButton = () => screen.getByRole('button', { name: 'Сохранить начальников' });

describe('DepartmentsTab members race (FE-0239)', () => {
  beforeEach(() => {
    [mockList, mockGetMembers, mockSetManagers, mockSyncFromAD].forEach((fn) => fn.mockReset());
    mockList.mockResolvedValue({ items: DEPTS });
    mockSetManagers.mockResolvedValue({ ok: true });
  });

  it('ignores a stale members response and saves only the selected department draft', async () => {
    const d1 = deferred();
    mockGetMembers.mockImplementation((id) => (
      String(id) === '1' ? d1.promise : Promise.resolve({ items: [member(13, 'manager')] })
    ));

    render(<DepartmentsTab canManageDepartments />);

    // Auto-selects D1; its members request is still in flight.
    await waitFor(() => {
      expect(mockGetMembers).toHaveBeenCalledWith('1');
    });

    await selectDepartment('Отдел D2');
    await screen.findByText('u13');

    // The late D1 response must be dropped — D2's member stays on screen.
    await act(async () => {
      d1.resolve({ items: [member(11, 'manager')] });
    });
    await waitFor(() => {
      expect(screen.queryByText('u11')).not.toBeInTheDocument();
    });
    expect(screen.getByText('u13')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => {
      expect(mockSetManagers).toHaveBeenCalledWith('2', [13]);
    });
  });

  it('blocks saving while the selected department members are still loading', async () => {
    const d2 = deferred();
    mockGetMembers.mockImplementation((id) => (
      String(id) === '1' ? Promise.resolve({ items: [member(11, 'manager')] }) : d2.promise
    ));

    render(<DepartmentsTab canManageDepartments />);
    await screen.findByText('u11');

    await selectDepartment('Отдел D2');
    // D2 members still in flight — the save must be unreachable.
    expect(saveButton()).toBeDisabled();
    expect(mockSetManagers).not.toHaveBeenCalled();

    await act(async () => {
      d2.resolve({ items: [member(13, 'manager')] });
    });
    await screen.findByText('u13');
    expect(saveButton()).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => {
      expect(mockSetManagers).toHaveBeenCalledWith('2', [13]);
    });
  });

  it('post-save reload follows the department selected during the save', async () => {
    const save = deferred();
    mockSetManagers.mockImplementation(() => save.promise);
    mockGetMembers.mockImplementation((id) => {
      const uid = { 1: 11, 2: 13, 3: 15 }[Number(id)] || 0;
      return Promise.resolve({ items: uid ? [member(uid, 'manager')] : [] });
    });
    mockList.mockResolvedValue({
      items: [...DEPTS, { id: 3, name: 'Отдел D3', members_count: 1, managers_count: 1, source: 'manual' }],
    });

    render(<DepartmentsTab canManageDepartments />);
    await screen.findByText('u11');
    await selectDepartment('Отдел D2');
    await screen.findByText('u13');

    await act(async () => {
      fireEvent.click(saveButton());
    });
    // During the in-flight save the user switches to D3; the post-save reload
    // must target D3, not the stale D2 captured when the save started.
    await selectDepartment('Отдел D3');
    await act(async () => {
      save.resolve({ ok: true });
    });

    await screen.findByText('u15');
    await waitFor(() => {
      expect(saveButton()).toBeEnabled();
    });
  });
});
