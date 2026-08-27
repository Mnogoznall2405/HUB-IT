import apiClient from './client';

export type CompanyStructureNode = {
  id: string;
  parent_id: string | null;
  node_type: string;
  title: string;
  person_name: string;
  person_position: string;
  person_employee_code: string | null;
  person_photo_url: string | null;
  direct_people_count: number;
  subtree_people_count: number;
  child_node_count: number;
  sort_order: number;
  is_active: boolean;
  department_codes: string[];
  children: CompanyStructureNode[];
};

export type CompanyStructurePerson = {
  full_name: string;
  position: string;
  department: string;
  department_location: string;
  work_phones: string[];
  work_emails: string[];
};

export type CompanyStructurePathItem = { id: string; title: string };

export type CompanyStructureSearchItem = {
  kind: 'node' | 'person';
  node_id: string | null;
  title: string;
  subtitle: string;
  department: string;
  department_location: string;
  work_phones: string[];
  work_emails: string[];
  path: CompanyStructurePathItem[];
};

export type CompanyStructureTree = { items: CompanyStructureNode[]; count: number };
export type CompanyStructurePeople = {
  node: CompanyStructureNode;
  department_codes: string[];
  matched_by_title: boolean;
  items: CompanyStructurePerson[];
  total: number;
};
export type CompanyStructureSearch = { items: CompanyStructureSearchItem[]; total: number; limit: number };

export type CompanyStructureLeaderCandidate = {
  employee_code: string;
  full_name: string;
  position: string;
  department: string;
  department_location: string;
};

export type CompanyStructureDepartmentCode = {
  department_code: string;
  department: string;
  department_location: string;
  department_locations: string[];
  people_count: number;
  binding_group: string;
  linked_node_id: string | null;
  linked_node_title: string;
};

export type CompanyStructureNodeDraft = {
  parent_id: string | null;
  node_type: string;
  title: string;
  person_name: string;
  person_position: string;
  person_employee_code: string | null;
  department_codes: string[];
};

export type CompanyStructureDepartmentName = {
  department: string;
  department_base: string;
  department_location: string;
  department_locations: string[];
  people_count: number;
  department_codes: string[];
  binding_group: string;
};

export type CompanyStructureImportResult = {
  created: CompanyStructureNode[];
  skipped: Array<{ department: string; reason: string }>;
};

export type CompanyStructurePhotoFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

export const COMPANY_STRUCTURE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maxLength = 2_048): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function textList(value: unknown, maxItems = 100): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  value.slice(0, maxItems).forEach((item) => {
    const normalized = text(item, 512);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

export function normalizeCompanyStructureNode(value: unknown, depth = 0): CompanyStructureNode | null {
  if (depth > 64) return null;
  const row = record(value);
  const id = text(row.id, 256);
  if (!id) return null;
  const children = (Array.isArray(row.children) ? row.children : [])
    .map((child) => normalizeCompanyStructureNode(child, depth + 1))
    .filter((child): child is CompanyStructureNode => Boolean(child));
  return {
    id,
    parent_id: text(row.parent_id, 256) || null,
    node_type: text(row.node_type, 64).toLowerCase() || 'other',
    title: text(row.title),
    person_name: text(row.person_name),
    person_position: text(row.person_position),
    person_employee_code: text(row.person_employee_code, 256) || null,
    person_photo_url: text(row.person_photo_url, 4_096) || null,
    direct_people_count: count(row.direct_people_count),
    subtree_people_count: count(row.subtree_people_count),
    child_node_count: count(row.child_node_count ?? children.length),
    sort_order: count(row.sort_order),
    is_active: row.is_active !== false,
    department_codes: textList(row.department_codes),
    children,
  };
}

export function normalizeCompanyStructurePerson(value: unknown): CompanyStructurePerson | null {
  const row = record(value);
  const fullName = text(row.full_name);
  if (!fullName) return null;
  return {
    full_name: fullName,
    position: text(row.position),
    department: text(row.department),
    department_location: text(row.department_location),
    work_phones: textList(row.work_phones, 20),
    work_emails: textList(row.work_emails, 20),
  };
}

function normalizePath(value: unknown): CompanyStructurePathItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = record(item);
    return { id: text(row.id, 256), title: text(row.title) };
  }).filter((item) => item.id && item.title);
}

export function normalizeCompanyStructureSearchItem(value: unknown): CompanyStructureSearchItem | null {
  const row = record(value);
  const kind = row.kind === 'person' ? 'person' : row.kind === 'node' ? 'node' : null;
  const title = text(row.title);
  if (!kind || !title) return null;
  return {
    kind,
    node_id: text(row.node_id, 256) || null,
    title,
    subtitle: text(row.subtitle),
    department: text(row.department),
    department_location: text(row.department_location),
    work_phones: textList(row.work_phones, 20),
    work_emails: textList(row.work_emails, 20),
    path: normalizePath(row.path),
  };
}

export async function getCompanyStructureTree(): Promise<CompanyStructureTree> {
  const { data } = await apiClient.get('/company-structure/tree', {
    params: { include_inactive: false },
  });
  const payload = record(data);
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .map((item) => normalizeCompanyStructureNode(item))
    .filter((item): item is CompanyStructureNode => Boolean(item));
  return { items, count: count(payload.count ?? items.length) };
}

export async function searchCompanyStructure(query: string, limit = 30): Promise<CompanyStructureSearch> {
  const q = text(query, 200);
  if (!q) return { items: [], total: 0, limit: Math.min(100, Math.max(1, limit)) };
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 30));
  const { data } = await apiClient.get('/company-structure/search', { params: { q, limit: safeLimit } });
  const payload = record(data);
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .map(normalizeCompanyStructureSearchItem)
    .filter((item): item is CompanyStructureSearchItem => Boolean(item));
  return { items, total: count(payload.total), limit: count(payload.limit) || safeLimit };
}

export async function getCompanyStructureNodePeople(
  nodeId: string,
  options: { limit?: number; includeDescendants?: boolean } = {},
): Promise<CompanyStructurePeople> {
  const id = text(nodeId, 256);
  if (!id) throw new Error('Не выбрано подразделение');
  const limit = Math.min(2_000, Math.max(1, Math.trunc(options.limit ?? 2_000)));
  const { data } = await apiClient.get(
    `/company-structure/nodes/${encodeURIComponent(id)}/people`,
    { params: { limit, include_descendants: options.includeDescendants !== false } },
  );
  const payload = record(data);
  const node = normalizeCompanyStructureNode(payload.node);
  if (!node) throw new Error('Сервер вернул некорректное подразделение');
  const items = (Array.isArray(payload.items) ? payload.items : [])
    .map(normalizeCompanyStructurePerson)
    .filter((item): item is CompanyStructurePerson => Boolean(item));
  return {
    node,
    department_codes: textList(payload.department_codes),
    matched_by_title: payload.matched_by_title === true,
    items,
    total: count(payload.total ?? items.length),
  };
}

function normalizeNodeResponse(value: unknown): CompanyStructureNode {
  const node = normalizeCompanyStructureNode(value);
  if (!node) throw new Error('Сервер вернул некорректный узел структуры');
  return node;
}

function normalizeNodeDraft(value: CompanyStructureNodeDraft): CompanyStructureNodeDraft {
  const titleValue = text(value.title);
  if (!titleValue) throw new Error('Укажите название узла');
  return {
    parent_id: text(value.parent_id, 256) || null,
    node_type: text(value.node_type, 64).toLowerCase() || 'other',
    title: titleValue,
    person_name: text(value.person_name),
    person_position: text(value.person_position),
    person_employee_code: text(value.person_employee_code, 256) || null,
    department_codes: textList(value.department_codes),
  };
}

export async function createCompanyStructureNode(
  draft: CompanyStructureNodeDraft,
): Promise<CompanyStructureNode> {
  const { data } = await apiClient.post('/company-structure/nodes', normalizeNodeDraft(draft));
  return normalizeNodeResponse(data);
}

export async function updateCompanyStructureNode(
  nodeId: string,
  draft: CompanyStructureNodeDraft,
): Promise<CompanyStructureNode> {
  const id = text(nodeId, 256);
  if (!id) throw new Error('Не выбран узел структуры');
  const { data } = await apiClient.patch(
    `/company-structure/nodes/${encodeURIComponent(id)}`,
    normalizeNodeDraft(draft),
  );
  return normalizeNodeResponse(data);
}

export async function moveCompanyStructureNode(
  nodeId: string,
  options: { parentId: string | null; position: number },
): Promise<CompanyStructureNode> {
  const id = text(nodeId, 256);
  if (!id) throw new Error('Не выбран узел структуры');
  const position = Math.max(0, Math.trunc(Number(options.position) || 0));
  const { data } = await apiClient.put(
    `/company-structure/nodes/${encodeURIComponent(id)}/position`,
    { parent_id: text(options.parentId, 256) || null, position },
  );
  return normalizeNodeResponse(data);
}

export async function deleteCompanyStructureNode(
  nodeId: string,
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; id: string; reparented_children: number }> {
  const id = text(nodeId, 256);
  if (!id) throw new Error('Не выбран узел структуры');
  const { data } = await apiClient.delete(
    `/company-structure/nodes/${encodeURIComponent(id)}`,
    { params: { force: options.force === true } },
  );
  const payload = record(data);
  return {
    ok: payload.ok === true,
    id: text(payload.id, 256) || id,
    reparented_children: count(payload.reparented_children),
  };
}

export async function searchCompanyStructureLeaderCandidates(
  query: string,
  limit = 30,
): Promise<{ items: CompanyStructureLeaderCandidate[]; total: number; limit: number }> {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 30));
  const { data } = await apiClient.get('/company-structure/leader-candidates', {
    params: { q: text(query, 200), limit: safeLimit },
  });
  const payload = record(data);
  const items = (Array.isArray(payload.items) ? payload.items : []).map((value) => {
    const row = record(value);
    return {
      employee_code: text(row.employee_code, 256),
      full_name: text(row.full_name),
      position: text(row.position),
      department: text(row.department),
      department_location: text(row.department_location),
    };
  }).filter((item) => item.employee_code && item.full_name);
  return { items, total: count(payload.total), limit: count(payload.limit) || safeLimit };
}

export async function searchCompanyStructureDepartmentCodes(
  query: string,
  limit = 50,
): Promise<{ items: CompanyStructureDepartmentCode[]; total: number; limit: number }> {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit) || 50));
  const { data } = await apiClient.get('/company-structure/department-codes', {
    params: { q: text(query, 200), limit: safeLimit },
  });
  const payload = record(data);
  const items = (Array.isArray(payload.items) ? payload.items : []).map((value) => {
    const row = record(value);
    return {
      department_code: text(row.department_code, 256),
      department: text(row.department),
      department_location: text(row.department_location),
      department_locations: textList(row.department_locations, 50),
      people_count: count(row.people_count),
      binding_group: text(row.binding_group, 64),
      linked_node_id: text(row.linked_node_id, 256) || null,
      linked_node_title: text(row.linked_node_title),
    };
  }).filter((item) => item.department_code);
  return { items, total: count(payload.total), limit: count(payload.limit) || safeLimit };
}

export async function searchCompanyStructureDepartmentNames(
  query: string,
  limit = 100,
): Promise<{ items: CompanyStructureDepartmentName[]; total: number; limit: number }> {
  const safeLimit = Math.min(1_000, Math.max(1, Math.trunc(limit) || 100));
  const { data } = await apiClient.get('/company-structure/department-names', {
    params: { q: text(query, 200), limit: safeLimit },
  });
  const payload = record(data);
  const items = (Array.isArray(payload.items) ? payload.items : []).map((value) => {
    const row = record(value);
    return {
      department: text(row.department),
      department_base: text(row.department_base),
      department_location: text(row.department_location),
      department_locations: textList(row.department_locations, 100),
      people_count: count(row.people_count),
      department_codes: textList(row.department_codes, 200),
      binding_group: text(row.binding_group, 64),
    };
  }).filter((item) => item.department);
  return { items, total: count(payload.total), limit: count(payload.limit) || safeLimit };
}

export async function importCompanyStructureFromZup(
  parentId: string | null,
  departments: string[],
): Promise<CompanyStructureImportResult> {
  const names = textList(departments, 500);
  if (!names.length) throw new Error('Выберите хотя бы одно подразделение ЗУП');
  const { data } = await apiClient.post('/company-structure/import-from-zup', {
    parent_id: text(parentId, 256) || null,
    departments: names,
  });
  const payload = record(data);
  const created = (Array.isArray(payload.created) ? payload.created : [])
    .map((item) => normalizeCompanyStructureNode(item))
    .filter((item): item is CompanyStructureNode => Boolean(item));
  const skipped = (Array.isArray(payload.skipped) ? payload.skipped : []).map((value) => {
    const row = record(value);
    return { department: text(row.department), reason: text(row.reason, 128) };
  }).filter((item) => item.department);
  return { created, skipped };
}

export function validateCompanyStructurePhoto(file: CompanyStructurePhotoFile): CompanyStructurePhotoFile {
  const mimeType = text(file.mimeType, 128).toLowerCase();
  const size = Number(file.size || 0);
  if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') {
    throw new Error('Для фото руководителя выберите растровое изображение');
  }
  if (!Number.isFinite(size) || size <= 0) throw new Error('Файл изображения пустой или недоступен');
  if (size > COMPANY_STRUCTURE_PHOTO_MAX_BYTES) throw new Error('Фото руководителя должно быть не больше 2 МБ');
  const uri = text(file.uri, 8_192);
  if (!uri) throw new Error('Файл изображения недоступен');
  return { uri, name: text(file.name, 512) || 'leader-photo.jpg', mimeType, size };
}

export async function uploadCompanyStructureNodePhoto(
  nodeId: string,
  file: CompanyStructurePhotoFile,
): Promise<CompanyStructureNode> {
  const id = text(nodeId, 256);
  if (!id) throw new Error('Не выбран узел структуры');
  const safeFile = validateCompanyStructurePhoto(file);
  const formData = new FormData();
  formData.append('file', {
    uri: safeFile.uri,
    name: safeFile.name,
    type: safeFile.mimeType,
  } as unknown as Blob);
  const { data } = await apiClient.post(
    `/company-structure/nodes/${encodeURIComponent(id)}/photo`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return normalizeNodeResponse(data);
}

export async function deleteCompanyStructureNodePhoto(
  nodeId: string,
): Promise<CompanyStructureNode> {
  const id = text(nodeId, 256);
  if (!id) throw new Error('Не выбран узел структуры');
  const { data } = await apiClient.delete(`/company-structure/nodes/${encodeURIComponent(id)}/photo`);
  return normalizeNodeResponse(data);
}
