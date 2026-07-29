import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./client', () => ({ default: apiClientMock }));

import { companyStructureAPI } from './companyStructure';

describe('company structure API contracts', () => {
  beforeEach(() => {
    Object.values(apiClientMock).forEach((mock) => {
      mock.mockReset();
      mock.mockResolvedValue({ data: { ok: true } });
    });
  });

  it('uses one atomic request to move a node', async () => {
    await companyStructureAPI.moveNode('node/1', { parentId: 'parent-1', position: 2 });

    expect(apiClientMock.put).toHaveBeenCalledWith(
      '/company-structure/nodes/node%2F1/position',
      { parent_id: 'parent-1', position: 2 },
    );
  });

  it('imports selected exact ZUP departments under the chosen parent', async () => {
    await companyStructureAPI.importFromZup({
      parentId: 'block-1',
      departments: ['Управление логистики', 'Отдел снабжения'],
    });

    expect(apiClientMock.post).toHaveBeenCalledWith('/company-structure/import-from-zup', {
      parent_id: 'block-1',
      departments: ['Управление логистики', 'Отдел снабжения'],
    });
  });

  it('searches the safe company directory', async () => {
    await companyStructureAPI.search({ q: 'Иванов', limit: 30 });

    expect(apiClientMock.get).toHaveBeenCalledWith('/company-structure/search', {
      params: { q: 'Иванов', limit: 30 },
    });
  });
});

