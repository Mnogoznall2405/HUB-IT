import { act, render, waitFor } from '@testing-library/react-native';
import * as myFilesApi from '../../api/myFilesApi';
import type { MyFileRecord } from '../../api/myFilesApi';
import { NativeMyFilesScreen } from './NativeMyFilesScreen';

const mockMyFileCardRender = jest.fn();

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 17 },
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/myFilesApi', () => ({
  listMyFiles: jest.fn(),
  getMyFilesQuota: jest.fn(),
  createMyFileShare: jest.fn(),
  getMyFilePreview: jest.fn(),
  revokeMyFileShare: jest.fn(),
  deleteMyFile: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeSnapshot: jest.fn(async () => true),
  readNativeEntitySnapshot: jest.fn(async () => null),
  writeNativeEntitySnapshot: jest.fn(async () => true),
}));

jest.mock('../../myFiles/nativeMyFilesOfflineStore', () => ({
  getNativeMyFilesOfflineFile: jest.fn(async () => null),
  getNativeMyFilesOfflineIds: jest.fn(async () => new Set()),
  pinNativeMyFileOffline: jest.fn(),
  removeNativeMyFileOffline: jest.fn(),
}));

jest.mock('../../myFiles/nativeMyFilesTransfers', () => ({
  downloadNativeMyFile: jest.fn(),
  downloadNativeMyFilePreview: jest.fn(),
  pickNativeMyFiles: jest.fn(async () => []),
  pickNativeMyFilesFolder: jest.fn(async () => null),
  readNativeMyFileTextPreview: jest.fn(),
  uploadNativeMyFile: jest.fn(),
}));

jest.mock('../../components/myFiles/NativeMyFileCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeMyFileCard: React.memo(({ item }: { item: MyFileRecord }) => {
      mockMyFileCardRender(item.id);
      return React.createElement(Text, null, item.original_file_name);
    }),
  };
});

const files = Array.from({ length: 30 }, (_, index) => ({
  id: `file-${index}`,
  original_file_name: `File ${String(index).padStart(2, '0')}.pdf`,
  download_file_name: `File ${String(index).padStart(2, '0')}.pdf`,
  mime_type: 'application/pdf',
  download_mime_type: 'application/pdf',
  original_size_bytes: 1024,
  stored_size_bytes: 900,
  saved_size_bytes: 124,
  retention_days: 7,
  status: 'ready',
  storage_mode: 'stored',
  error_text: '',
  security_scan_status: 'clean',
  preview_kind: 'pdf',
  preview_available: true,
  preview_status: 'ready',
  preview_max_bytes: 0,
  is_shared: false,
  share_expires_at: null,
  created_at: null,
  updated_at: null,
  expires_at: '2026-09-08T10:00:00Z',
})) as MyFileRecord[];

const mockedApi = myFilesApi as jest.Mocked<typeof myFilesApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listMyFiles.mockResolvedValue(files);
  mockedApi.getMyFilesQuota.mockResolvedValue({
    used_bytes: files.length * 1024,
    limit_bytes: 5 * 1024 ** 3,
    remaining_bytes: 5 * 1024 ** 3 - files.length * 1024,
  });
});

it('does not rerender mounted file cards for a refresh spinner', async () => {
  const view = await render(<NativeMyFilesScreen />);
  await waitFor(() => expect(view.getByText('File 09.pdf')).toBeTruthy());
  mockMyFileCardRender.mockClear();

  mockedApi.listMyFiles.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-my-files-list').props.onRefresh();
  });
  const refreshSpinnerRenders = mockMyFileCardRender.mock.calls.length;

  expect(refreshSpinnerRenders).toBe(0);
});
