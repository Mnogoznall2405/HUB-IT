import { act, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import * as companyApi from '../../api/companyStructureApi';
import type { CompanyStructureNode } from '../../api/companyStructureApi';
import { NativeCompanyStructureScreen } from './NativeCompanyStructureScreen';

const mockCompanyNodeCardRender = jest.fn();

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 0 },
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../components/companyStructure/NativeCompanyNodeCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeCompanyNodeCard: React.memo(({ node }: { node: CompanyStructureNode }) => {
      mockCompanyNodeCardRender(node.id);
      return React.createElement(Text, null, node.title);
    }),
  };
});

jest.mock('../../components/companyStructure/NativeCompanyPersonCard', () => ({
  NativeCompanyPersonCard: () => null,
}));
jest.mock('../../components/companyStructure/NativeCompanyPeopleSheet', () => ({
  NativeCompanyPeopleSheet: () => null,
}));
jest.mock('../../components/companyStructure/NativeCompanyHierarchySheet', () => ({
  NativeCompanyHierarchySheet: () => null,
}));
jest.mock('../../components/companyStructure/NativeCompanyNodeEditorSheet', () => ({
  NativeCompanyNodeEditorSheet: () => null,
}));
jest.mock('../../components/companyStructure/NativeCompanyZupImportSheet', () => ({
  NativeCompanyZupImportSheet: () => null,
}));

jest.mock('../../navigation/moduleRegistry', () => ({ openPortalPath: jest.fn() }));
jest.mock('../../addressBook/messengerLinks', () => ({ openExternalUrl: jest.fn(async () => true) }));
jest.mock('../../files/nativeFilePicker', () => ({
  NativeFilePermissionError: class NativeFilePermissionError extends Error {
    canAskAgain = true;
  },
  pickNativeAttachment: jest.fn(),
  openAppPermissionSettings: jest.fn(),
}));
jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
  readNativeEntitySnapshot: jest.fn(async () => null),
  writeNativeEntitySnapshot: jest.fn(async () => true),
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

function node(id: string, title: string, children: CompanyStructureNode[] = []): CompanyStructureNode {
  return {
    id,
    parent_id: null,
    node_type: id === 'root' ? 'root' : id === 'block' ? 'block' : 'department',
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

const departments = Array.from({ length: 30 }, (_, index) => {
  const item = node(`department-${index}`, `Department ${String(index).padStart(2, '0')}`);
  item.parent_id = 'block';
  item.sort_order = index;
  return item;
});
const block = node('block', 'Main block', departments);
block.parent_id = 'root';
const root = node('root', 'Company', [block]);

const mockedParams = useLocalSearchParams as jest.Mock;
const mockedApi = companyApi as jest.Mocked<typeof companyApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedParams.mockReturnValue({});
  mockedApi.getCompanyStructureTree.mockResolvedValue({ items: [root], count: 1 });
  mockedApi.getCompanyStructureNodePeople.mockResolvedValue({
    node: block,
    department_codes: [],
    matched_by_title: false,
    items: [],
    total: 0,
  });
});

it('does not rerender mounted company nodes for the refresh spinner', async () => {
  const view = await render(<NativeCompanyStructureScreen />);
  await waitFor(() => expect(view.getByText('Department 09')).toBeTruthy());
  mockCompanyNodeCardRender.mockClear();

  mockedApi.getCompanyStructureTree.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-company-list').props.onRefresh();
  });

  expect(mockCompanyNodeCardRender).toHaveBeenCalledTimes(0);
});
