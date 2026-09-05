import apiClient from './client';
import { getTaskDelegates, searchUsers, updateTaskDelegates, updateUser } from './authUserAdminApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn(), put: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock; patch: jest.Mock; put: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('updates Exchange mapping through the existing admin user contract', async () => {
  client.patch.mockResolvedValueOnce({ data: { id: 7, username: 'user', mailbox_email: 'user@example.com', mailbox_login: 'DOMAIN\\user' } });
  await updateUser(7, { mailbox_email: 'user@example.com', mailbox_login: 'DOMAIN\\user' });
  expect(client.patch).toHaveBeenCalledWith('/auth/users/7', {
    mailbox_email: 'user@example.com',
    mailbox_login: 'DOMAIN\\user',
  });
});

it('loads and replaces task delegate links', async () => {
  client.get.mockResolvedValueOnce({ data: [{ owner_user_id: 7, delegate_user_id: 8, role_type: 'assistant', is_active: true }] });
  client.put.mockResolvedValueOnce({ data: [{ owner_user_id: 7, delegate_user_id: 8, role_type: 'deputy', is_active: true }] });
  await expect(getTaskDelegates(7)).resolves.toHaveLength(1);
  await expect(updateTaskDelegates(7, [{ delegate_user_id: 8, role_type: 'deputy', is_active: true }])).resolves.toHaveLength(1);
  expect(client.put).toHaveBeenCalledWith('/auth/users/7/task-delegates', {
    items: [{ delegate_user_id: 8, role_type: 'deputy', is_active: true }],
  });
});

it('searches admin users through the bounded endpoint', async () => {
  client.get.mockResolvedValueOnce({
    data: {
      items: [{ id: 9, username: 'ivanov', full_name: 'Иванов Иван' }],
      total: 1,
      limit: 30,
      offset: 0,
      has_more: false,
    },
  });

  await expect(searchUsers({
    q: 'иванов',
    limit: 30,
    offset: 0,
    status: 'active',
    role: 'operator',
    excludeUserId: 7,
    ids: [9, 10],
  })).resolves.toEqual(expect.objectContaining({ total: 1, has_more: false }));

  expect(client.get).toHaveBeenCalledWith('/auth/users/search', {
    params: {
      q: 'иванов',
      limit: 30,
      offset: 0,
      status: 'active',
      role: 'operator',
      exclude_user_id: 7,
      ids: '9,10',
    },
  });
});
