import type {
  CompanyStructureNode,
  CompanyStructurePerson,
  CompanyStructureSearchItem,
} from '../api/companyStructureApi';

const NODE_TYPE_LABELS: Record<string, string> = {
  root: 'Руководитель компании',
  block: 'Блок',
  deputy: 'Заместитель',
  service: 'Служба',
  directorate: 'Управление',
  department: 'Отдел',
  group: 'Группа',
  other: 'Подразделение',
};

export const COMPANY_NODE_TYPE_OPTIONS = Object.entries(NODE_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const PERSON_CARD_NODE_TYPES = new Set(['root', 'deputy']);
const CONTAINER_NODE_TYPES = new Set(['block']);

export function companyNodeUsesDepartmentBindings(nodeType: string): boolean {
  const type = String(nodeType || '').trim().toLowerCase();
  return !PERSON_CARD_NODE_TYPES.has(type) && !CONTAINER_NODE_TYPES.has(type);
}

export function companyNodeUsesLeader(nodeType: string): boolean {
  return PERSON_CARD_NODE_TYPES.has(String(nodeType || '').trim().toLowerCase());
}

export function defaultCompanyChildType(parent: CompanyStructureNode | null | undefined): string {
  if (!parent) return 'root';
  if (parent.node_type === 'root') return 'block';
  if (parent.node_type === 'block') return 'deputy';
  if (parent.node_type === 'deputy') return 'directorate';
  return 'department';
}

export function flattenCompanyStructure(
  nodes: CompanyStructureNode[],
): Array<{ node: CompanyStructureNode; depth: number }> {
  const result: Array<{ node: CompanyStructureNode; depth: number }> = [];
  const visit = (items: CompanyStructureNode[], depth: number) => {
    items.forEach((node) => {
      result.push({ node, depth });
      visit(node.children, depth + 1);
    });
  };
  visit(nodes, 0);
  return result;
}

export function collectCompanyDescendantIds(node: CompanyStructureNode | null | undefined): Set<string> {
  const result = new Set<string>();
  const stack = [...(node?.children || [])];
  while (stack.length) {
    const child = stack.pop();
    if (!child || result.has(child.id)) continue;
    result.add(child.id);
    stack.push(...child.children);
  }
  return result;
}

export function companyNodeTitle(node: CompanyStructureNode | null | undefined): string {
  return String(node?.title || node?.person_position || 'Без названия').trim() || 'Без названия';
}

export function companyNodeTypeLabel(node: CompanyStructureNode | null | undefined): string {
  return NODE_TYPE_LABELS[String(node?.node_type || '').toLowerCase()] || 'Подразделение';
}

export type CompanyStructureIndex = {
  nodeById: Map<string, CompanyStructureNode>;
  parentById: Map<string, string | null>;
};

export function buildCompanyStructureIndex(nodes: CompanyStructureNode[]): CompanyStructureIndex {
  const nodeById = new Map<string, CompanyStructureNode>();
  const parentById = new Map<string, string | null>();
  const stack = nodes.map((node) => ({ node, parentId: null as string | null }));
  while (stack.length) {
    const entry = stack.pop();
    if (!entry || nodeById.has(entry.node.id)) continue;
    nodeById.set(entry.node.id, entry.node);
    parentById.set(entry.node.id, entry.parentId);
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: entry.node.children[index], parentId: entry.node.id });
    }
  }
  return { nodeById, parentById };
}

export function companyNodePathFromIndex(
  index: CompanyStructureIndex,
  nodeId: string,
): CompanyStructureNode[] {
  const path: CompanyStructureNode[] = [];
  const visited = new Set<string>();
  let currentId: string | null = String(nodeId || '') || null;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = index.nodeById.get(currentId);
    if (!node) return [];
    path.push(node);
    currentId = index.parentById.get(currentId) ?? null;
  }
  return path.reverse();
}

export function findCompanyNode(
  nodes: CompanyStructureNode[],
  nodeId: string,
): CompanyStructureNode | null {
  const target = String(nodeId || '');
  if (!target) return null;
  return buildCompanyStructureIndex(nodes).nodeById.get(target) || null;
}

export function findCompanyNodePath(
  nodes: CompanyStructureNode[],
  nodeId: string,
): CompanyStructureNode[] {
  const target = String(nodeId || '');
  if (!target) return [];
  return companyNodePathFromIndex(buildCompanyStructureIndex(nodes), target);
}

export function getCompanyRootAndBlocks(nodes: CompanyStructureNode[]): {
  root: CompanyStructureNode | null;
  blocks: CompanyStructureNode[];
} {
  const root = nodes.find((node) => node.node_type === 'root') || nodes[0] || null;
  const children = root?.children || [];
  const typedBlocks = children.filter((node) => node.node_type === 'block');
  return { root, blocks: typedBlocks.length ? typedBlocks : children };
}

export function resolveInitialCompanySelection(
  nodes: CompanyStructureNode[],
  requestedNodeId = '',
  requestedBlockId = '',
): { nodeId: string; blockId: string } {
  const { root, blocks } = getCompanyRootAndBlocks(nodes);
  const requestedNode = findCompanyNode(nodes, requestedNodeId);
  const requestedPath = requestedNode ? findCompanyNodePath(nodes, requestedNode.id) : [];
  const pathBlock = requestedPath.find((node) => node.node_type === 'block');
  const requestedBlock = blocks.find((node) => node.id === requestedBlockId);
  const block = pathBlock || requestedBlock || blocks[0] || root;
  return {
    nodeId: requestedNode?.id || block?.id || root?.id || '',
    blockId: pathBlock?.id || requestedBlock?.id || blocks[0]?.id || '',
  };
}

export function sortedCompanyChildren(node: CompanyStructureNode | null): CompanyStructureNode[] {
  return [...(node?.children || [])].sort((left, right) => (
    left.sort_order - right.sort_order
      || companyNodeTitle(left).localeCompare(companyNodeTitle(right), 'ru')
  ));
}

export type CompanyLeadershipRole = 'head' | 'deputy' | 'staff';

export function companyLeadershipRole(person: CompanyStructurePerson): CompanyLeadershipRole {
  const position = person.position.trim().toLocaleLowerCase('ru-RU');
  if (/(?:^|\s)(?:первый\s+)?(?:заместитель|зам\.?)\s+.*начальник/u.test(position)) return 'deputy';
  if (/(?:^|\s)начальник(?:\s|$)/u.test(position)) return 'head';
  return 'staff';
}

export function companyPersonKey(person: CompanyStructurePerson, index = 0): string {
  return `${person.full_name}|${person.position}|${person.department}|${index}`;
}

export function companyPersonInitials(name: string): string {
  return String(name || '').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '—';
}

export function sortCompanyPeople(items: CompanyStructurePerson[]): CompanyStructurePerson[] {
  const order: Record<CompanyLeadershipRole, number> = { head: 0, deputy: 1, staff: 2 };
  return [...items].sort((left, right) => (
    order[companyLeadershipRole(left)] - order[companyLeadershipRole(right)]
      || left.department_location.localeCompare(right.department_location, 'ru')
      || left.full_name.localeCompare(right.full_name, 'ru')
  ));
}

export type CompanyPeopleSection = {
  key: string;
  title: string;
  items: CompanyStructurePerson[];
};

export function groupCompanyPeople(items: CompanyStructurePerson[]): CompanyPeopleSection[] {
  const leadership: CompanyStructurePerson[] = [];
  const locations = new Map<string, CompanyStructurePerson[]>();
  sortCompanyPeople(items).forEach((person) => {
    if (companyLeadershipRole(person) !== 'staff') {
      leadership.push(person);
      return;
    }
    const location = person.department_location.trim() || 'Без указанного города';
    const current = locations.get(location) || [];
    current.push(person);
    locations.set(location, current);
  });
  const sections: CompanyPeopleSection[] = [];
  if (leadership.length) sections.push({ key: 'leadership', title: 'Руководство подразделения', items: leadership });
  [...locations.entries()].sort(([left], [right]) => left.localeCompare(right, 'ru')).forEach(([location, people]) => {
    sections.push({ key: `location-${location}`, title: location, items: people });
  });
  return sections;
}

export function companySearchMeta(item: CompanyStructureSearchItem): string {
  return [
    item.kind === 'person' ? item.subtitle : 'Подразделение',
    item.department_location,
    item.path.map((part) => part.title).join(' / '),
  ].filter(Boolean).join(' · ');
}

export function searchItemToCompanyPerson(item: CompanyStructureSearchItem): CompanyStructurePerson {
  return {
    full_name: item.title,
    position: item.subtitle,
    department: item.department,
    department_location: item.department_location,
    work_phones: item.work_phones,
    work_emails: item.work_emails,
  };
}
