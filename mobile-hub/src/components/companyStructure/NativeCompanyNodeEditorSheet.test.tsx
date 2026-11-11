import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as companyApi from '../../api/companyStructureApi';
import type { CompanyStructureNode } from '../../api/companyStructureApi';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeCompanyNodeEditorSheet } from './NativeCompanyNodeEditorSheet';

jest.mock('../../api/companyStructureApi', () => ({
  searchCompanyStructureLeaderCandidates: jest.fn(),
  searchCompanyStructureDepartmentCodes: jest.fn(),
}));

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
    subtree_people_count: 0,
    child_node_count: children.length,
    sort_order: 0,
    is_active: true,
    department_codes: [],
    children,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (companyApi.searchCompanyStructureLeaderCandidates as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 30 });
  (companyApi.searchCompanyStructureDepartmentCodes as jest.Mock).mockResolvedValue({
    items: [{
      department_code: 'office-1',
      department: 'Офис',
      department_location: 'Екатеринбург',
      department_locations: ['Екатеринбург'],
      people_count: 10,
      binding_group: 'office',
      linked_node_id: null,
      linked_node_title: '',
    }, {
      department_code: 'object-1',
      department: 'Объект',
      department_location: 'Москва',
      department_locations: ['Москва'],
      people_count: 5,
      binding_group: 'object',
      linked_node_id: null,
      linked_node_title: '',
    }],
    total: 2,
    limit: 100,
  });
});

it('reparents without exposing the edited node descendants and applies a ZUP binding group', async () => {
  const descendant = node('child-1', 'group', 'Дочерняя группа');
  const department = node('dep-1', 'department', 'Поддержка', [descendant]);
  descendant.parent_id = department.id;
  const block = node('block-1', 'block', 'ИТ-блок', [department]);
  department.parent_id = block.id;
  const root = node('root', 'root', 'Компания', [block]);
  block.parent_id = root.id;
  const save = jest.fn();
  const view = await render(
    <NativeCompanyNodeEditorSheet
      visible
      mode="edit"
      tree={[root]}
      selectedNode={department}
      saving={false}
      mutationError=""
      tokens={getFluentTokens('light')}
      onClose={jest.fn()}
      onSave={save}
    />,
  );

  await act(async () => { fireEvent.press(view.getByLabelText('Родительский узел: ИТ-блок')); });
  await waitFor(() => expect(view.getByLabelText('Доступные родительские узлы')).toBeTruthy());
  expect(view.queryByLabelText('Выбрать родителя Дочерняя группа')).toBeNull();
  await act(async () => { fireEvent.press(view.getByLabelText('Выбрать родителя Компания')); });

  fireEvent.changeText(view.getByLabelText('Поиск подразделений ЗУП'), 'Офис');
  await waitFor(() => expect(companyApi.searchCompanyStructureDepartmentCodes).toHaveBeenCalledWith('Офис', 100), { timeout: 1_500 });
  await waitFor(() => expect(view.getByTestId('native-company-select-office-codes').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(view.getByTestId('native-company-select-office-codes')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-company-save')); });

  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    parent_id: 'root',
    department_codes: ['office-1'],
  }));
});

it('selects a leader from ZUP and keeps the employee identity in the draft', async () => {
  const root = node('root', 'root', 'Компания');
  root.person_name = 'Старый руководитель';
  root.person_position = 'Директор';
  root.person_employee_code = 'old-1';
  (companyApi.searchCompanyStructureLeaderCandidates as jest.Mock).mockResolvedValue({
    items: [{
      employee_code: 'employee-2',
      full_name: 'Новый Руководитель',
      position: 'Генеральный директор',
      department: 'Управление',
      department_location: 'Екатеринбург',
    }],
    total: 1,
    limit: 30,
  });
  const save = jest.fn();
  const view = await render(
    <NativeCompanyNodeEditorSheet
      visible
      mode="edit"
      tree={[root]}
      selectedNode={root}
      saving={false}
      mutationError=""
      tokens={getFluentTokens('light')}
      onClose={jest.fn()}
      onSave={save}
    />,
  );

  fireEvent.changeText(view.getByLabelText('Поиск руководителя'), 'Новый');
  await waitFor(() => expect(companyApi.searchCompanyStructureLeaderCandidates).toHaveBeenCalledWith('Новый', 30), { timeout: 1_500 });
  await waitFor(() => expect(view.getByText('Новый Руководитель')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByText('Новый Руководитель')); });
  await waitFor(() => expect(view.getByText('Выбран сотрудник ЗУП: Новый Руководитель')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-company-save')); });

  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    person_employee_code: 'employee-2',
    person_name: 'Новый Руководитель',
    person_position: 'Генеральный директор',
  }));
});
