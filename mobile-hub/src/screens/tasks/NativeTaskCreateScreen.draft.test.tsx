import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as taskApi from '../../api/taskApi';
import { clearNativeFormDrafts, createNativeFormDraftSession } from '../../drafts/nativeFormDrafts';
import { NativeTaskCreateScreen } from './NativeTaskCreateScreen';

const mockStore = new Map<string, string>();
jest.mock('../../cache/nativeSnapshotStorage', () => ({
  readEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => mockStore.get(`${user}:${scope}`) || null),
  writeEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number, data: string) => { mockStore.set(`${user}:${scope}`, data); return true; }),
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => { mockStore.delete(`${user}:${scope}`); }),
}));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, offlineMode: false, hasPermission: () => true }) }));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: { theme_mode: 'system' } }) }));
jest.mock('../../api/taskApi', () => ({
  getTaskProjects: jest.fn(async () => [{ id: 'project', name: 'Project' }]), getTaskObjects: jest.fn(async () => []),
  searchTaskAssignees: jest.fn(async () => [{ id: 7, full_name: 'Assignee' }]), searchTaskControllers: jest.fn(async () => []),
  createTask: jest.fn(), uploadTaskAttachment: jest.fn(),
}));
jest.mock('../../api/departmentsApi', () => ({ listDepartments: jest.fn(async () => []) }));

it('restores created task IDs and retries only remaining durable uploads after restart', async () => {
  await clearNativeFormDrafts();
  const source = new File(Paths.cache, 'task-pending-upload'); source.write('pending attachment');
  const file = { uri: source.uri, name: 'pending.txt', size: source.size, mimeType: 'text/plain' };
  await createNativeFormDraftSession(1, 'task-create').write({
    title: 'Existing created task', description: 'Preserved', dueDate: '', emailReminder: 'default', priority: 'normal',
    selectedAssigneeIds: [7], projectId: 'project', controllerId: null, observerIds: [], objectId: '', departmentId: '', visibility: 'private',
    checklistText: '', checklistItems: [], files: [file], protocolDate: '2026-09-01', newProjectName: '', newObjectName: '',
    uploadRecovery: { taskIds: ['already-created'], pending: [{ taskId: 'already-created', file }] },
  });
  source.delete();
  jest.mocked(taskApi.uploadTaskAttachment).mockResolvedValue({ id: 'attachment', file_name: 'pending.txt' });
  const view = await render(<NativeTaskCreateScreen />);
  await waitFor(() => expect(view.getByTestId('native-task-create-submit')).toBeEnabled());
  await fireEvent.press(view.getByTestId('native-task-create-submit'));
  await waitFor(() => expect(taskApi.uploadTaskAttachment).toHaveBeenCalledTimes(1));
  expect(taskApi.createTask).not.toHaveBeenCalled();
  const [taskId, upload] = jest.mocked(taskApi.uploadTaskAttachment).mock.calls[0];
  expect(taskId).toBe('already-created');
  expect(upload.uri).not.toBe(source.uri);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/(shell)/tasks/[taskId]', params: { taskId: 'already-created' } }));
  expect(await createNativeFormDraftSession(1, 'task-create').read()).toBeNull();
  await view.unmount();
});
