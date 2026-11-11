import apiClient from './client';
import { listDepartments } from './departmentsApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('loads departments without an unsupported server search and normalizes counters', async () => {
  client.get.mockResolvedValue({
    data: {
      items: [
        { id: 'it', name: 'ИТ', members_count: 8, managers_count: 2 },
        { id: 'ops', name: 'Эксплуатация', member_count: 4, manager_count: 1 },
      ],
    },
  });

  await expect(listDepartments()).resolves.toEqual([
    expect.objectContaining({ id: 'it', members_count: 8, managers_count: 2 }),
    expect.objectContaining({ id: 'ops', members_count: 4, managers_count: 1 }),
  ]);
  expect(client.get).toHaveBeenCalledWith('/departments');
});
