export const NODE_TYPE_OPTIONS = [
  { value: 'root', label: 'Корень / Гендир' },
  { value: 'block', label: 'Блок' },
  { value: 'deputy', label: 'Заместитель' },
  { value: 'service', label: 'Служба' },
  { value: 'directorate', label: 'Управление' },
  { value: 'department', label: 'Отдел' },
  { value: 'group', label: 'Группа' },
  { value: 'other', label: 'Прочее' },
];

/** Types that are people cards — no ZUP department binding. */
export const PERSON_CARD_NODE_TYPES = new Set(['deputy', 'root']);

/** Types that usually don't bind ZUP people (containers). */
export const CONTAINER_NODE_TYPES = new Set(['block']);

export function usesZupDepartmentBinding(nodeType) {
  const type = String(nodeType || '').trim().toLowerCase();
  return !PERSON_CARD_NODE_TYPES.has(type) && !CONTAINER_NODE_TYPES.has(type);
}

export function resolveNodeTitle({ node_type, title, person_name, person_position }) {
  const typedTitle = String(title || '').trim();
  if (typedTitle) return typedTitle;
  const type = String(node_type || '').trim().toLowerCase();
  if (PERSON_CARD_NODE_TYPES.has(type)) {
    return String(person_position || person_name || 'Заместитель').trim() || 'Заместитель';
  }
  return '';
}

export function flattenTree(nodes, depth = 0, acc = []) {
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    if (!node?.id) return;
    acc.push({ ...node, depth, children: undefined, childCount: Array.isArray(node.children) ? node.children.length : 0 });
    flattenTree(node.children, depth + 1, acc);
  });
  return acc;
}

export function findNodeById(nodes, nodeId) {
  const target = String(nodeId || '');
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (String(node?.id) === target) return node;
    const nested = findNodeById(node?.children, target);
    if (nested) return nested;
  }
  return null;
}

export function findNodePath(nodes, nodeId, ancestors = []) {
  const target = String(nodeId || '');
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const path = [...ancestors, node];
    if (String(node?.id) === target) return path;
    const nested = findNodePath(node?.children, target, path);
    if (nested.length) return nested;
  }
  return [];
}

export function collectDescendantIds(node, acc = new Set()) {
  (Array.isArray(node?.children) ? node.children : []).forEach((child) => {
    if (!child?.id) return;
    acc.add(String(child.id));
    collectDescendantIds(child, acc);
  });
  return acc;
}

export function collectExpandableIds(nodes, acc = new Set()) {
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    if (Array.isArray(node?.children) && node.children.length > 0) {
      acc.add(String(node.id));
      collectExpandableIds(node.children, acc);
    }
  });
  return acc;
}

export function nodeCardTitle(node) {
  return String(node?.title || node?.person_position || 'Без названия').trim() || 'Без названия';
}
