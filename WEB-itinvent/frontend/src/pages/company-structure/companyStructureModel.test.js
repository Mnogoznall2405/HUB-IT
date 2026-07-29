import { describe, expect, it } from 'vitest';
import {
  collectExpandableIds,
  collectDescendantIds,
  findNodeById,
  findNodePath,
  flattenTree,
  nodeCardTitle,
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
});
