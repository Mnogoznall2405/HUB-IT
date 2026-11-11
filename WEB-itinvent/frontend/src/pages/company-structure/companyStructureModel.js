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

export const SEMANTIC_LEVEL_BY_TYPE = Object.freeze({
  root: 0,
  block: 1,
  deputy: 2,
  directorate: 3,
  service: 3,
  department: 4,
  group: 5,
});

export const SEMANTIC_LEVEL_LABELS = Object.freeze({
  0: 'Руководитель компании',
  1: 'Блок',
  2: 'Руководители',
  3: 'Управления и службы',
  4: 'Отделы',
  5: 'Группы',
});

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

export function resolveSemanticLevel(node, parentLevel = -1) {
  const typedLevel = SEMANTIC_LEVEL_BY_TYPE[String(node?.node_type || '').toLowerCase()];
  const minimumLevel = Number.isFinite(parentLevel) ? parentLevel + 1 : 0;
  return Math.max(Number.isFinite(typedLevel) ? typedLevel : minimumLevel, minimumLevel);
}

export function buildSemanticLevelMap(nodes) {
  const levels = new Map();
  const visit = (items, parentLevel = -1) => {
    (Array.isArray(items) ? items : []).forEach((node) => {
      if (!node?.id) return;
      const level = resolveSemanticLevel(node, parentLevel);
      levels.set(String(node.id), level);
      visit(node.children, level);
    });
  };
  visit(nodes);
  return levels;
}

export function getCompanyRootAndBlocks(tree) {
  const roots = Array.isArray(tree) ? tree : [];
  const root = roots.find((node) => node?.node_type === 'root') || roots[0] || null;
  const rootChildren = Array.isArray(root?.children) ? root.children : [];
  const blocks = rootChildren.filter((node) => node?.node_type === 'block');
  return { root, blocks: blocks.length ? blocks : rootChildren };
}

export function collectVisibleSemanticGraph(tree, blockId, expandedIds = new Set()) {
  const { root, blocks } = getCompanyRootAndBlocks(tree);
  if (!root) return { nodes: [], edges: [], rootId: '', blockId: '' };
  const selectedBlock = blocks.find((node) => String(node.id) === String(blockId)) || blocks[0] || null;
  const nodes = [];
  const edges = [];

  const visit = (node, parent = null, parentLevel = -1) => {
    if (!node?.id) return;
    const nodeId = String(node.id);
    const level = resolveSemanticLevel(node, parentLevel);
    nodes.push({ node, nodeId, level });
    if (parent) {
      edges.push({
        id: `${String(parent.node.id)}-${nodeId}`,
        source: String(parent.node.id),
        target: nodeId,
        sourceLevel: parent.level,
        targetLevel: level,
      });
    }
    if (!expandedIds.has(nodeId)) return;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => visit(child, { node, level }, level));
  };

  const rootId = String(root.id);
  const rootLevel = resolveSemanticLevel(root, -1);
  nodes.push({ node: root, nodeId: rootId, level: rootLevel });
  if (selectedBlock) visit(selectedBlock, { node: root, level: rootLevel }, rootLevel);
  return {
    nodes,
    edges,
    rootId,
    blockId: selectedBlock ? String(selectedBlock.id) : '',
  };
}

export function initialExpandedIdsForBlock(tree, blockId) {
  const { root } = getCompanyRootAndBlocks(tree);
  return new Set([root?.id].filter(Boolean).map(String));
}
