import type { CompanyStructureNode, CompanyStructurePerson } from '../api/companyStructureApi';
import {
  buildCompanyStructureIndex,
  collectCompanyDescendantIds,
  companyLeadershipRole,
  companyNodePathFromIndex,
  companyNodeUsesDepartmentBindings,
  companyNodeUsesLeader,
  defaultCompanyChildType,
  flattenCompanyStructure,
  groupCompanyPeople,
  resolveInitialCompanySelection,
  sortedCompanyChildren,
} from './nativeCompanyStructureModel';

function node(id: string, nodeType: string, title: string, children: CompanyStructureNode[] = [], sortOrder = 0): CompanyStructureNode {
  return {
    id,
    parent_id: null,
    node_type: nodeType,
    title,
    person_name: '',
    person_position: '',
    person_employee_code: null,
    person_photo_url: null,
    direct_people_count: 0,
    subtree_people_count: 0,
    child_node_count: children.length,
    sort_order: sortOrder,
    is_active: true,
    department_codes: [],
    children,
  };
}

function person(fullName: string, position: string, city: string): CompanyStructurePerson {
  return {
    full_name: fullName,
    position,
    department: 'ИТ',
    department_location: city,
    work_phones: [],
    work_emails: [],
  };
}

const dep = node('dep-1', 'department', 'Поддержка');
const block = node('block-1', 'block', 'ИТ-блок', [dep]);
const root = node('root', 'root', 'Компания', [block]);

it('builds one iterative index and returns a stable breadcrumb path', () => {
  const index = buildCompanyStructureIndex([root]);
  expect([...index.nodeById.keys()]).toEqual(['root', 'block-1', 'dep-1']);
  expect(companyNodePathFromIndex(index, 'dep-1').map((item) => item.id)).toEqual(['root', 'block-1', 'dep-1']);
  expect(companyNodePathFromIndex(index, 'missing')).toEqual([]);
});

it('resolves deep links inside their block and sorts direct children', () => {
  expect(resolveInitialCompanySelection([root], 'dep-1', '')).toEqual({ nodeId: 'dep-1', blockId: 'block-1' });
  const unordered = node('group', 'group', 'Группа', [
    node('b', 'department', 'Бета', [], 2),
    node('a', 'department', 'Альфа', [], 1),
  ]);
  expect(sortedCompanyChildren(unordered).map((item) => item.id)).toEqual(['a', 'b']);
});

it('groups leadership first and then staff by city', () => {
  const head = person('Руководитель', 'Начальник отдела', 'Москва');
  const deputy = person('Заместитель', 'Заместитель начальника отдела', 'Екатеринбург');
  const staff = person('Специалист', 'Инженер', 'Москва');
  expect(companyLeadershipRole(head)).toBe('head');
  expect(companyLeadershipRole(deputy)).toBe('deputy');
  expect(groupCompanyPeople([staff, deputy, head]).map((section) => ({ title: section.title, names: section.items.map((item) => item.full_name) }))).toEqual([
    { title: 'Руководство подразделения', names: ['Руководитель', 'Заместитель'] },
    { title: 'Москва', names: ['Специалист'] },
  ]);
});

it('prepares safe editor choices for types, parents and descendants', () => {
  expect(defaultCompanyChildType(root)).toBe('block');
  expect(defaultCompanyChildType(block)).toBe('deputy');
  expect(companyNodeUsesLeader('deputy')).toBe(true);
  expect(companyNodeUsesDepartmentBindings('department')).toBe(true);
  expect(companyNodeUsesDepartmentBindings('block')).toBe(false);
  expect(flattenCompanyStructure([root]).map(({ node: item, depth }) => `${depth}:${item.id}`)).toEqual([
    '0:root', '1:block-1', '2:dep-1',
  ]);
  expect([...collectCompanyDescendantIds(root)]).toEqual(expect.arrayContaining(['block-1', 'dep-1']));
});
