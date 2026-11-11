import { fireEvent, render } from '@testing-library/react-native';
import type { CompanyStructureNode } from '../../api/companyStructureApi';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeCompanyHierarchySheet } from './NativeCompanyHierarchySheet';

function node(
  id: string,
  nodeType: string,
  title: string,
  children: CompanyStructureNode[] = [],
): CompanyStructureNode {
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
    subtree_people_count: children.length,
    child_node_count: children.length,
    sort_order: 0,
    is_active: true,
    department_codes: [],
    children,
  };
}

it('shows the complete hierarchy with accessible levels and selects a deep node', async () => {
  const select = jest.fn();
  const department = node('dep-1', 'department', 'Поддержка');
  const block = node('block-1', 'block', 'ИТ-блок', [department]);
  department.parent_id = block.id;
  const root = node('root', 'root', 'Компания', [block]);
  block.parent_id = root.id;

  const view = await render(
    <NativeCompanyHierarchySheet
      visible
      tree={[root]}
      selectedId="block-1"
      tokens={getFluentTokens('light')}
      onClose={jest.fn()}
      onSelect={select}
    />,
  );

  expect(view.getByTestId('native-company-hierarchy-list')).toBeTruthy();
  expect(view.getByLabelText('Компания, Руководитель компании, уровень 1')).toBeTruthy();
  expect(view.getByLabelText('ИТ-блок, Блок, уровень 2').props.accessibilityState.selected).toBe(true);
  fireEvent.press(view.getByLabelText('Поддержка, Отдел, уровень 3'));
  expect(select).toHaveBeenCalledWith('dep-1');
});
