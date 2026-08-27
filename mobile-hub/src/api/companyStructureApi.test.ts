import apiClient from './client';
import {
  createCompanyStructureNode,
  deleteCompanyStructureNode,
  deleteCompanyStructureNodePhoto,
  getCompanyStructureNodePeople,
  getCompanyStructureTree,
  moveCompanyStructureNode,
  importCompanyStructureFromZup,
  searchCompanyStructure,
  searchCompanyStructureDepartmentCodes,
  searchCompanyStructureDepartmentNames,
  searchCompanyStructureLeaderCandidates,
  updateCompanyStructureNode,
  uploadCompanyStructureNodePhoto,
  validateCompanyStructurePhoto,
} from './companyStructureApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const client = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

it('loads the active tree and normalizes nested nodes defensively', async () => {
  client.get.mockResolvedValue({
    data: {
      count: '1',
      items: [{
        id: ' root ',
        node_type: 'ROOT',
        title: ' Компания ',
        children: [
          { id: 'block-1', parent_id: 'root', node_type: 'block', title: 'ИТ', subtree_people_count: '5' },
          { title: 'invalid without id' },
        ],
      }],
    },
  });

  await expect(getCompanyStructureTree()).resolves.toMatchObject({
    count: 1,
    items: [{ id: 'root', node_type: 'root', title: 'Компания', children: [{ id: 'block-1', subtree_people_count: 5 }] }],
  });
  expect(client.get).toHaveBeenCalledWith('/company-structure/tree', {
    params: { include_inactive: false },
  });
});

it('trims search input, caps the limit and drops malformed results', async () => {
  client.get.mockResolvedValue({
    data: {
      total: 2,
      limit: 100,
      items: [
        { kind: 'person', node_id: 'dep-1', title: 'Иванов Иван', work_phones: ['100', '100', ''] },
        { kind: 'unknown', title: 'invalid' },
      ],
    },
  });

  const result = await searchCompanyStructure('  Иванов  ', 500);
  expect(result.items).toEqual([expect.objectContaining({
    kind: 'person',
    node_id: 'dep-1',
    title: 'Иванов Иван',
    work_phones: ['100'],
  })]);
  expect(client.get).toHaveBeenCalledWith('/company-structure/search', {
    params: { q: 'Иванов', limit: 100 },
  });
});

it('encodes the node id and loads descendants with a bounded limit', async () => {
  client.get.mockResolvedValue({
    data: {
      node: { id: 'dep/1', node_type: 'department', title: 'ИТ' },
      items: [{ full_name: 'Иванов Иван', work_emails: ['ivanov@example.com'] }],
      total: '1',
      matched_by_title: true,
    },
  });

  await expect(getCompanyStructureNodePeople('dep/1', { limit: 9_000 })).resolves.toMatchObject({
    node: { id: 'dep/1' },
    items: [{ full_name: 'Иванов Иван', work_emails: ['ivanov@example.com'] }],
    total: 1,
    matched_by_title: true,
  });
  expect(client.get).toHaveBeenCalledWith('/company-structure/nodes/dep%2F1/people', {
    params: { limit: 2_000, include_descendants: true },
  });
});

it('creates and edits nodes with normalized parent, leader and department bindings', async () => {
  const response = { id: 'dep-1', node_type: 'department', title: 'Поддержка' };
  client.post.mockResolvedValue({ data: response });
  client.patch.mockResolvedValue({ data: response });
  const draft = {
    parent_id: ' block-1 ',
    node_type: ' DEPARTMENT ',
    title: ' Поддержка ',
    person_name: '',
    person_position: '',
    person_employee_code: null,
    department_codes: [' 001 ', '001', '002'],
  };

  await createCompanyStructureNode(draft);
  await updateCompanyStructureNode('dep/1', draft);

  expect(client.post).toHaveBeenCalledWith('/company-structure/nodes', expect.objectContaining({
    parent_id: 'block-1', node_type: 'department', title: 'Поддержка', department_codes: ['001', '002'],
  }));
  expect(client.patch).toHaveBeenCalledWith('/company-structure/nodes/dep%2F1', expect.any(Object));
});

it('moves and deletes a node through encoded mutation routes', async () => {
  client.put.mockResolvedValue({ data: { id: 'dep/1', node_type: 'department', title: 'Поддержка' } });
  client.delete.mockResolvedValue({ data: { ok: true, id: 'dep/1', reparented_children: 2 } });

  await moveCompanyStructureNode('dep/1', { parentId: 'block-2', position: -5 });
  await expect(deleteCompanyStructureNode('dep/1', { force: true })).resolves.toEqual({
    ok: true, id: 'dep/1', reparented_children: 2,
  });
  expect(client.put).toHaveBeenCalledWith('/company-structure/nodes/dep%2F1/position', {
    parent_id: 'block-2', position: 0,
  });
  expect(client.delete).toHaveBeenCalledWith('/company-structure/nodes/dep%2F1', {
    params: { force: true },
  });
});

it('normalizes leader and department binding suggestions', async () => {
  client.get
    .mockResolvedValueOnce({ data: { items: [{ employee_code: ' e-1 ', full_name: ' Иванов Иван ', position: 'Начальник' }], total: 1, limit: 30 } })
    .mockResolvedValueOnce({ data: { items: [{ department_code: ' 001 ', department: ' ИТ ', people_count: '7', linked_node_id: 'dep-2' }], total: 1, limit: 50 } });

  await expect(searchCompanyStructureLeaderCandidates(' Иванов ')).resolves.toMatchObject({
    items: [{ employee_code: 'e-1', full_name: 'Иванов Иван', position: 'Начальник' }],
  });
  await expect(searchCompanyStructureDepartmentCodes(' ИТ ')).resolves.toMatchObject({
    items: [{ department_code: '001', department: 'ИТ', people_count: 7, linked_node_id: 'dep-2' }],
  });
});

it('searches exact ZUP department cards and imports only an explicit normalized selection', async () => {
  client.get.mockResolvedValue({
    data: { items: [{ department: ' ИТ объект ', department_codes: [' 001 ', '001'], people_count: '8', binding_group: 'object' }], total: 1, limit: 100 },
  });
  client.post.mockResolvedValue({
    data: {
      created: [{ id: 'dep-1', node_type: 'department', title: 'ИТ объект' }],
      skipped: [{ department: 'Финансы', reason: 'already_imported' }],
    },
  });

  await expect(searchCompanyStructureDepartmentNames(' ИТ ', 5_000)).resolves.toMatchObject({
    items: [{ department: 'ИТ объект', department_codes: ['001'], people_count: 8 }],
    limit: 100,
  });
  await expect(importCompanyStructureFromZup(' block-1 ', [' ИТ объект ', 'ИТ объект', ' Финансы '])).resolves.toMatchObject({
    created: [{ id: 'dep-1' }],
    skipped: [{ department: 'Финансы', reason: 'already_imported' }],
  });
  expect(client.get).toHaveBeenCalledWith('/company-structure/department-names', { params: { q: 'ИТ', limit: 1_000 } });
  expect(client.post).toHaveBeenCalledWith('/company-structure/import-from-zup', {
    parent_id: 'block-1', departments: ['ИТ объект', 'Финансы'],
  });
});

it('validates, uploads and deletes a leader photo through the existing multipart contract', async () => {
  const response = { id: 'root/1', node_type: 'root', title: 'Генеральный директор', person_photo_url: '/photo' };
  client.post.mockResolvedValue({ data: response });
  client.delete.mockResolvedValue({ data: { ...response, person_photo_url: null } });
  const photo = { uri: 'file:///leader.jpg', name: 'leader.jpg', mimeType: 'image/jpeg', size: 512_000 };

  expect(validateCompanyStructurePhoto(photo)).toEqual(photo);
  expect(() => validateCompanyStructurePhoto({ ...photo, mimeType: 'video/mp4' })).toThrow('растровое изображение');
  expect(() => validateCompanyStructurePhoto({ ...photo, size: 2 * 1024 * 1024 + 1 })).toThrow('не больше 2 МБ');
  await uploadCompanyStructureNodePhoto('root/1', photo);
  await deleteCompanyStructureNodePhoto('root/1');

  expect(client.post).toHaveBeenCalledWith(
    '/company-structure/nodes/root%2F1/photo',
    expect.any(FormData),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  expect(client.delete).toHaveBeenCalledWith('/company-structure/nodes/root%2F1/photo');
});
