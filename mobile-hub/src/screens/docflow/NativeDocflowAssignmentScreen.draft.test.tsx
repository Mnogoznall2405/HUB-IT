import { render, waitFor } from '@testing-library/react-native';
import * as api from '../../api/docflowApi';
import { clearNativeFormDrafts, createNativeFormDraftSession } from '../../drafts/nativeFormDrafts';
import { NativeDocflowAssignmentScreen } from './NativeDocflowAssignmentScreen';
const mockStore = new Map<string, string>();
jest.mock('../../cache/nativeSnapshotStorage', () => ({
  readEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => mockStore.get(`${user}:${scope}`) || null),
  writeEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number, data: string) => { mockStore.set(`${user}:${scope}`, data); return true; }),
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => { mockStore.delete(`${user}:${scope}`); }),
}));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, offlineMode: false, hasPermission: () => true }) }));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: { theme_mode: 'system' } }) }));
jest.mock('../../api/docflowApi', () => ({
  getDocflowAssignmentCapability: jest.fn(async () => ({ enabled: true, test_only: false })),
  searchDocflowAssignmentAssignees: jest.fn(async () => ({ items: [] })),
  searchDocflowAssignmentDocuments: jest.fn(), createDocflowAssignment: jest.fn(), getDocflowAssignmentCommand: jest.fn(() => new Promise(() => {})),
}));

it('restores an unresolved command after restart and polls it instead of creating again', async () => {
  await clearNativeFormDrafts();
  await createNativeFormDraftSession(1, 'docflow-assignment').write({
    selectedDocument: { ref: 'document', document_type: 'internal', title: 'Document' }, selectedAssignee: { ref: 'person', name: 'Person' },
    selectedController: null, dueDate: '2026-09-25', dueTime: '17:00', importance: 'normal', title: 'Preserved title', description: 'Preserved text',
    command: { command_id: 'existing-command', status: 'state_unknown' }, created: null, attempt: { signature: 'original', key: 'original-key' },
  });
  const view = await render(<NativeDocflowAssignmentScreen />);
  await waitFor(() => expect(view.queryByTestId('native-docflow-assignment-submit')).toBeNull());
  await waitFor(() => expect(api.getDocflowAssignmentCommand).toHaveBeenCalledWith('existing-command'), { timeout: 2500 });
  expect(api.createDocflowAssignment).not.toHaveBeenCalled();
  expect(view.getByTestId('native-docflow-assignment-title').props.value).toBe('Preserved title');
  await view.unmount();
});
