import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import * as companyApi from '../../api/companyStructureApi';
import * as nativeFilePicker from '../../files/nativeFilePicker';
import type { CompanyStructureNode, CompanyStructurePerson } from '../../api/companyStructureApi';
import { NativeCompanyStructureScreen } from './NativeCompanyStructureScreen';

let mockPermissions = ['company_structure.read', 'company_structure.write'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));
jest.mock('../../navigation/moduleRegistry', () => ({ openPortalPath: jest.fn() }));
jest.mock('../../addressBook/messengerLinks', () => ({ openExternalUrl: jest.fn().mockResolvedValue(true) }));
jest.mock('../../files/nativeFilePicker', () => ({
  NativeFilePermissionError: class NativeFilePermissionError extends Error {
    canAskAgain = true;
  },
  pickNativeAttachment: jest.fn(),
  openAppPermissionSettings: jest.fn(),
}));
jest.mock('../../api/companyStructureApi', () => ({
  getCompanyStructureTree: jest.fn(),
  getCompanyStructureNodePeople: jest.fn(),
  searchCompanyStructure: jest.fn(),
  createCompanyStructureNode: jest.fn(),
  updateCompanyStructureNode: jest.fn(),
  moveCompanyStructureNode: jest.fn(),
  deleteCompanyStructureNode: jest.fn(),
  searchCompanyStructureLeaderCandidates: jest.fn(),
  searchCompanyStructureDepartmentCodes: jest.fn(),
  searchCompanyStructureDepartmentNames: jest.fn(),
  importCompanyStructureFromZup: jest.fn(),
  uploadCompanyStructureNodePhoto: jest.fn(),
  deleteCompanyStructureNodePhoto: jest.fn(),
}));

const params = useLocalSearchParams as jest.Mock;

afterEach(() => cleanup());

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
    direct_people_count: 1,
    subtree_people_count: 1,
    child_node_count: children.length,
    sort_order: sortOrder,
    is_active: true,
    department_codes: [],
    children,
  };
}

const employee: CompanyStructurePerson = {
  full_name: 'Иванов Иван',
  position: 'Инженер',
  department: 'Поддержка',
  department_location: 'Екатеринбург',
  work_phones: ['100'],
  work_emails: ['ivanov@example.com'],
};
let department: CompanyStructureNode;
let secondDepartment: CompanyStructureNode;
let block: CompanyStructureNode;
let root: CompanyStructureNode;

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['company_structure.read', 'company_structure.write'];
  mockOfflineMode = false;
  department = node('dep-1', 'department', 'Поддержка');
  department.parent_id = 'block-1';
  secondDepartment = node('dep-2', 'department', 'Инфраструктура', [], 1);
  secondDepartment.parent_id = 'block-1';
  block = node('block-1', 'block', 'ИТ-блок', [department, secondDepartment]);
  block.parent_id = 'root';
  root = node('root', 'root', 'Компания', [block]);
  params.mockReturnValue({});
  (companyApi.getCompanyStructureTree as jest.Mock).mockResolvedValue({ items: [root], count: 1 });
  (companyApi.getCompanyStructureNodePeople as jest.Mock).mockImplementation(async (nodeId: string) => ({
    node: nodeId === 'dep-1' ? department : block,
    department_codes: [],
    matched_by_title: false,
    items: nodeId === 'dep-1' ? [employee] : [],
    total: nodeId === 'dep-1' ? 1 : 0,
  }));
  (companyApi.searchCompanyStructure as jest.Mock).mockResolvedValue({
    items: [{
      kind: 'person',
      node_id: 'dep-1',
      title: employee.full_name,
      subtitle: employee.position,
      department: employee.department,
      department_location: employee.department_location,
      work_phones: employee.work_phones,
      work_emails: employee.work_emails,
      path: [{ id: 'block-1', title: 'ИТ-блок' }, { id: 'dep-1', title: 'Поддержка' }],
    }],
    total: 1,
    limit: 30,
  });
  (companyApi.createCompanyStructureNode as jest.Mock).mockResolvedValue(node('created-1', 'block', 'Новый блок'));
  (companyApi.updateCompanyStructureNode as jest.Mock).mockResolvedValue(department);
  (companyApi.moveCompanyStructureNode as jest.Mock).mockResolvedValue(department);
  (companyApi.deleteCompanyStructureNode as jest.Mock).mockResolvedValue({ ok: true, id: 'dep-1', reparented_children: 0 });
  (companyApi.searchCompanyStructureLeaderCandidates as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 30 });
  (companyApi.searchCompanyStructureDepartmentCodes as jest.Mock).mockResolvedValue({
    items: [{
      department_code: '001',
      department: 'Поддержка ЗУП',
      department_location: 'Екатеринбург',
      department_locations: ['Екатеринбург'],
      people_count: 7,
      binding_group: 'object',
      linked_node_id: null,
      linked_node_title: '',
    }, {
      department_code: '002',
      department: 'Сеть ЗУП',
      department_location: 'Москва',
      department_locations: ['Москва'],
      people_count: 4,
      binding_group: 'office',
      linked_node_id: 'dep-2',
      linked_node_title: 'Инфраструктура',
    }],
    total: 2,
    limit: 100,
  });
  (companyApi.searchCompanyStructureDepartmentNames as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 500 });
  (companyApi.importCompanyStructureFromZup as jest.Mock).mockResolvedValue({ created: [], skipped: [] });
  (companyApi.uploadCompanyStructureNodePhoto as jest.Mock).mockResolvedValue(root);
  (companyApi.deleteCompanyStructureNodePhoto as jest.Mock).mockResolvedValue(root);
  (nativeFilePicker.pickNativeAttachment as jest.Mock).mockResolvedValue(null);
});

it('opens a block, navigates to a leaf and renders its people inline', async () => {
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByText('Поддержка')).toBeTruthy());
  expect(companyApi.getCompanyStructureNodePeople).toHaveBeenCalledWith('block-1', {
    limit: 2_000,
    includeDescendants: true,
  });

  await act(async () => {
    fireEvent.press(view.getByLabelText('Поддержка, Отдел'));
  });
  await waitFor(() => expect(view.getByText('Иванов Иван')).toBeTruthy());
  expect(companyApi.getCompanyStructureNodePeople).toHaveBeenCalledWith('dep-1', {
    limit: 2_000,
    includeDescendants: true,
  });
});

it('searches from two characters and opens the found person in the native people sheet', async () => {
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByTestId('native-company-search')).toBeTruthy());
  fireEvent.changeText(view.getByTestId('native-company-search'), 'Ив');
  await waitFor(() => expect(companyApi.searchCompanyStructure).toHaveBeenCalledWith('Ив', 30), { timeout: 1_500 });
  await waitFor(() => expect(view.getByText('Иванов Иван')).toBeTruthy());
  fireEvent.press(view.getByText('Иванов Иван'));
  await waitFor(() => expect(view.getByTestId('native-company-people-list')).toBeTruthy());
});

it('keeps the selected node native and omits the web editor fallback', async () => {
  params.mockReturnValue({ nodeId: 'dep-1', blockId: 'block-1' });
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByTestId('native-company-open-hierarchy')).toBeTruthy());
  expect(view.queryByTestId('native-company-open-web')).toBeNull();
});

it('opens the complete native hierarchy and navigates directly to a deep node', async () => {
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByTestId('native-company-open-hierarchy')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-company-open-hierarchy'));
  await waitFor(() => expect(view.getByTestId('native-company-hierarchy-list')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Поддержка, Отдел, уровень 3'));
  await waitFor(() => expect(companyApi.getCompanyStructureNodePeople).toHaveBeenCalledWith('dep-1', {
    limit: 2_000,
    includeDescendants: true,
  }));
});

it('applies a new deep-link target while the native screen is already mounted', async () => {
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(companyApi.getCompanyStructureNodePeople).toHaveBeenCalledWith('block-1', expect.anything()));
  params.mockReturnValue({ nodeId: 'dep-1', blockId: 'block-1' });
  await view.rerender(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(companyApi.getCompanyStructureNodePeople).toHaveBeenCalledWith('dep-1', {
    limit: 2_000,
    includeDescendants: true,
  }));
});

it('does not request organization data without read permission', async () => {
  mockPermissions = [];
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(companyApi.getCompanyStructureTree).not.toHaveBeenCalled();
  expect(companyApi.getCompanyStructureNodePeople).not.toHaveBeenCalled();
});

it('does not expose writer and import controls to a read-only user', async () => {
  mockPermissions = ['company_structure.read'];
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByTestId('native-company-list')).toBeTruthy());
  expect(view.queryByTestId('native-company-create')).toBeNull();
  expect(view.queryByTestId('native-company-import-zup')).toBeNull();
  expect(view.queryByTestId('native-company-photo')).toBeNull();
});

it('does not start requests offline and exposes an explicit offline empty state', async () => {
  mockOfflineMode = true;
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByText('Нет данных для автономного режима')).toBeTruthy());
  expect(companyApi.getCompanyStructureTree).not.toHaveBeenCalled();
  expect(view.getByTestId('native-company-search').props.editable).toBe(false);
  expect(view.getByTestId('native-company-open-hierarchy').props.accessibilityState.disabled).toBe(true);
});

it('exposes manual import and leader photo actions without starting either operation', async () => {
  params.mockReturnValue({ nodeId: 'root', blockId: 'block-1' });
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByTestId('native-company-import-zup')).toBeTruthy());
  expect(view.getByTestId('native-company-photo')).toBeTruthy();
  expect(companyApi.importCompanyStructureFromZup).not.toHaveBeenCalled();
  expect(nativeFilePicker.pickNativeAttachment).not.toHaveBeenCalled();
  expect(companyApi.uploadCompanyStructureNodePhoto).not.toHaveBeenCalled();
});

it('edits a department and selects an available ZUP binding natively', async () => {
  params.mockReturnValue({ nodeId: 'dep-1', blockId: 'block-1' });
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByTestId('native-company-edit')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-company-edit')); });
  await waitFor(() => expect(view.getByText('Изменить узел')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Поиск подразделений ЗУП'), 'Под');
  await waitFor(() => expect(companyApi.searchCompanyStructureDepartmentCodes).toHaveBeenCalledWith('Под', 100), { timeout: 1_500 });
  await waitFor(() => expect(view.getByLabelText('002 Сеть ЗУП, уже привязан: Инфраструктура').props.accessibilityState.disabled).toBe(true));
  fireEvent.press(view.getByText('001 · Поддержка ЗУП'));
  await waitFor(() => expect(view.getByLabelText('Удалить привязку 001')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-company-save')); });

  await waitFor(() => expect(companyApi.updateCompanyStructureNode).toHaveBeenCalledWith('dep-1', expect.objectContaining({
    parent_id: 'block-1',
    department_codes: ['001'],
  })));
  await waitFor(() => expect(companyApi.getCompanyStructureTree).toHaveBeenCalledTimes(2));
});

it('reorders a selected node and confirms destructive deletion', async () => {
  params.mockReturnValue({ nodeId: 'dep-1', blockId: 'block-1' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByLabelText('Переместить ниже')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Переместить ниже'));
  await waitFor(() => expect(companyApi.moveCompanyStructureNode).toHaveBeenCalledWith('dep-1', {
    parentId: 'block-1',
    position: 1,
  }));
  await waitFor(() => expect(companyApi.getCompanyStructureTree).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByTestId('native-company-delete').props.accessibilityState.disabled).toBe(false));

  fireEvent.press(view.getByTestId('native-company-delete'));
  expect(alert).toHaveBeenCalled();
  const buttons = alert.mock.calls.at(-1)?.[2] || [];
  const destructive = buttons.find((button) => button.style === 'destructive');
  await act(async () => { destructive?.onPress?.(); });
  await waitFor(() => expect(companyApi.deleteCompanyStructureNode).toHaveBeenCalledWith('dep-1', { force: false }));
  alert.mockRestore();
});
