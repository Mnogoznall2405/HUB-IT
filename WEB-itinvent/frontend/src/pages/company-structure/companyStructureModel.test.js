import { describe, expect, it } from 'vitest';
import {
  collectExpandableIds,
  collectDescendantIds,
  collectVisibleSemanticGraph,
  buildSemanticLevelMap,
  findNodeById,
  findNodePath,
  flattenTree,
  initialExpandedIdsForBlock,
  nodeCardTitle,
  resolveSemanticLevel,
  resolveNodeTitle,
  usesZupDepartmentBinding,
} from './companyStructureModel';

const sampleTree = [
  {
    id: 'root',
    title: 'Генеральный директор',
    children: [
      {
        id: 'build',
        title: 'Строительный блок',
        children: [
          { id: 'dep', title: 'Зам', person_name: 'Иванов', children: [] },
        ],
      },
      { id: 'admin', title: 'Административный блок', children: [] },
    ],
  },
];

describe('companyStructureModel', () => {
  it('flattens tree with depth', () => {
    const flat = flattenTree(sampleTree);
    expect(flat.map((item) => [item.id, item.depth])).toEqual([
      ['root', 0],
      ['build', 1],
      ['dep', 2],
      ['admin', 1],
    ]);
  });

  it('finds nested node and expandable ids', () => {
    expect(findNodeById(sampleTree, 'dep')?.title).toBe('Зам');
    expect([...collectExpandableIds(sampleTree)].sort()).toEqual(['build', 'root']);
    expect(findNodePath(sampleTree, 'dep').map((node) => node.id)).toEqual(['root', 'build', 'dep']);
    expect([...collectDescendantIds(sampleTree[0])].sort()).toEqual(['admin', 'build', 'dep']);
  });

  it('builds card title from title or position', () => {
    expect(nodeCardTitle({ title: 'Служба' })).toBe('Служба');
    expect(nodeCardTitle({ title: '', person_position: 'Заместитель' })).toBe('Заместитель');
  });

  it('resolves deputy title from position and binds ZUP only for org units', () => {
    expect(resolveNodeTitle({
      node_type: 'deputy',
      title: '',
      person_position: 'Заместитель генерального директора',
    })).toBe('Заместитель генерального директора');
    expect(usesZupDepartmentBinding('deputy')).toBe(false);
    expect(usesZupDepartmentBinding('department')).toBe(true);
    expect(usesZupDepartmentBinding('directorate')).toBe(true);
  });

  it('keeps semantic types on separate vertical levels', () => {
    expect(resolveSemanticLevel({ node_type: 'root' }, -1)).toBe(0);
    expect(resolveSemanticLevel({ node_type: 'block' }, 0)).toBe(1);
    expect(resolveSemanticLevel({ node_type: 'deputy' }, 1)).toBe(2);
    expect(resolveSemanticLevel({ node_type: 'directorate', person_name: 'Руководитель' }, 1)).toBe(3);
    expect(resolveSemanticLevel({ node_type: 'department' }, 1)).toBe(4);
    expect(resolveSemanticLevel({ node_type: 'other' }, 3)).toBe(4);
  });

  it('creates long semantic edges when intermediate levels are absent', () => {
    const tree = [{
      id: 'root',
      node_type: 'root',
      children: [{
        id: 'block',
        node_type: 'block',
        children: [
          { id: 'deputy', node_type: 'deputy', children: [] },
          { id: 'directorate', node_type: 'directorate', person_name: 'Начальник', children: [] },
          { id: 'department', node_type: 'department', children: [] },
        ],
      }],
    }];
    const graph = collectVisibleSemanticGraph(tree, 'block', new Set(['root', 'block']));
    const levels = new Map(graph.nodes.map((item) => [item.nodeId, item.level]));
    expect(levels.get('deputy')).toBe(2);
    expect(levels.get('directorate')).toBe(3);
    expect(levels.get('department')).toBe(4);
    expect(graph.edges.find((edge) => edge.target === 'department')).toMatchObject({
      sourceLevel: 1,
      targetLevel: 4,
    });
    expect(buildSemanticLevelMap(tree).get('department')).toBe(4);
    expect([...initialExpandedIdsForBlock(tree, 'block')]).toEqual(['root']);
  });
});
