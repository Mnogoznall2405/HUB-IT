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

  it('loads the same employee subtree that is counted on an org card', async () => {
    await companyStructureAPI.getNodePeople('node/1');

    expect(apiClientMock.get).toHaveBeenCalledWith(
      '/company-structure/nodes/node%2F1/people',
      { params: { limit: 2000, include_descendants: true } },
    );
  });

  it('searches leader candidates without exposing personal contacts', async () => {
    await companyStructureAPI.searchLeaderCandidates({ q: 'Иванов', limit: 20 });

    expect(apiClientMock.get).toHaveBeenCalledWith('/company-structure/leader-candidates', {
      params: { q: 'Иванов', limit: 20 },
    });
  });

  it('uploads a leader photo as multipart data', async () => {
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });

    await companyStructureAPI.uploadNodePhoto('node/1', file);

    const [url, body, config] = apiClientMock.post.mock.calls[0];
    expect(url).toBe('/company-structure/nodes/node%2F1/photo');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
  });
});
