import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';
import * as messengerLinks from '../../addressBook/messengerLinks';
import * as docflowApi from '../../api/docflowApi';
import type { DocflowTaskDetail } from '../../api/docflowApi';
import * as docflowFiles from '../../docflow/nativeDocflowFiles';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import {
  clearNativeSnapshots,
  writeNativeCollectionSnapshot,
  writeNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import { openPortalPath } from '../../navigation/moduleRegistry';
import {
  docflowKeyboardAvoidingBehavior,
  NativeDocflowDetailScreen,
} from './NativeDocflowDetailScreen';
import { NativeDocflowAssignmentScreen } from './NativeDocflowAssignmentScreen';
import { NativeDocflowInboxScreen } from './NativeDocflowInboxScreen';

let mockPermissions = ['docflow.read', 'docflow.act', 'docflow.create'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'ivanov' },
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));
jest.mock('../../navigation/moduleRegistry', () => ({ openPortalPath: jest.fn() }));
jest.mock('../../addressBook/messengerLinks', () => ({ openExternalUrl: jest.fn() }));
jest.mock('../../api/docflowApi', () => ({
  applyDocflowTaskAction: jest.fn(),
  createDocflowAssignment: jest.fn(),
  deleteDocflowCredentials: jest.fn(),
  getDocflowAssignmentCapability: jest.fn(),
  getDocflowAssignmentCommand: jest.fn(),
  getDocflowCommand: jest.fn(),
  getDocflowProfile: jest.fn(),
  listDocflowTasks: jest.fn(),
  getDocflowTask: jest.fn(),
  saveDocflowCredentials: jest.fn(),
  searchDocflowAssignmentAssignees: jest.fn(),
  searchDocflowAssignmentDocuments: jest.fn(),
  testDocflowCredentials: jest.fn(),
}));
jest.mock('../../docflow/nativeDocflowFiles', () => ({
  downloadNativeDocflowFile: jest.fn(),
  downloadNativeDocflowPreview: jest.fn(),
}));
jest.mock('../../files/nativeAttachmentDownloads', () => ({ openNativeFile: jest.fn(), shareNativeFile: jest.fn() }));

const params = useLocalSearchParams as jest.Mock;
const task: DocflowTaskDetail = {
  ref: '11111111-1111-1111-1111-111111111111',
  task_type: 'task',
  task_type_label: 'Задание исполнителя',
  title: 'Согласовать договор',
  number: 'D-7',
  created_at: '2026-08-20T10:00:00+05:00',
  due_at: '2026-08-25T18:00:00+05:00',
  author: 'Петров Пётр',
  subject: 'Договор',
  description: 'Проверьте документ.',
  result: null,
  business_state: 'На согласовании',
  importance: 'Высокая',
  accepted: false,
  completed_at: null,
  completed: false,
  xdto_task_type: null,
  process_name: 'Согласование договора',
  process_ref: null,
  process_type: 'approval',
  process_type_label: 'Согласование',
  xdto_process_type: null,
  dm_version: '1',
  configuration_fingerprint: null,
  state_token: 'state-token-1234567890',
  available_actions: [{ code: 'approve', label: 'Согласовать', tone: 'success', comment_mode: 'optional' }],
  action_unavailable_reason: null,
  requires_digital_signature: false,
  open_in_1c_url: null,
  related_objects: [],
  files: [],
  files_incomplete: false,
};
const enriched: DocflowTaskDetail = {
  ...task,
  related_objects: [{ ref: 'doc-1', object_type: 'internal', object_type_label: 'Внутренний документ', title: 'Договор №7' }],
  files: [{
    ref: 'file-1',
    name: 'contract.pdf',
    extension: 'pdf',
    content_type: 'application/pdf',
    size: 1_024,
    created_at: null,
    description: null,
    preview_supported: true,
  }],
};

beforeEach(async () => {
  await clearNativeSnapshots(1);
  jest.clearAllMocks();
  mockPermissions = ['docflow.read', 'docflow.act', 'docflow.create'];
  mockOfflineMode = false;
  params.mockReturnValue({});
  (docflowApi.getDocflowProfile as jest.Mock).mockResolvedValue({
    configured: true,
    login: 'ivanov',
    status: 'valid',
    last_error_code: null,
    last_verified_at: null,
    updated_at: null,
  });
  (docflowApi.listDocflowTasks as jest.Mock).mockResolvedValue({
    items: [task],
    returned: 1,
    scope: 'inbox',
    source: 'live_1c',
    as_of: '2026-08-24T10:00:00+05:00',
    truncated: false,
  });
  (docflowApi.getDocflowTask as jest.Mock)
    .mockResolvedValueOnce(task)
    .mockResolvedValueOnce(enriched);
  (docflowApi.applyDocflowTaskAction as jest.Mock).mockResolvedValue({
    command_id: 'cmd-applied',
    status: 'applied',
    correlation_id: 'corr-applied',
    error_code: null,
    task: { ...enriched, completed: true, completed_at: '2026-08-24T11:00:00+05:00', available_actions: [], state_token: null },
  });
  (docflowApi.getDocflowCommand as jest.Mock).mockResolvedValue({
    command_id: 'cmd-applied',
    status: 'applied',
    correlation_id: 'corr-applied',
    error_code: null,
    task: { ...enriched, completed: true, completed_at: '2026-08-24T11:00:00+05:00', available_actions: [], state_token: null },
  });
  (docflowApi.testDocflowCredentials as jest.Mock).mockResolvedValue(undefined);
  (docflowApi.saveDocflowCredentials as jest.Mock).mockResolvedValue({
    configured: true,
    login: 'ivanov',
    status: 'valid',
    last_error_code: null,
    last_verified_at: null,
    updated_at: null,
  });
  (docflowApi.deleteDocflowCredentials as jest.Mock).mockResolvedValue(undefined);
  (docflowApi.getDocflowAssignmentCapability as jest.Mock).mockResolvedValue({
    enabled: true,
    reason: null,
    document_types: ['internal', 'incoming', 'outgoing'],
    test_only: true,
    required_title_prefix: 'HUB-IT TEST',
  });
  (docflowApi.searchDocflowAssignmentAssignees as jest.Mock).mockResolvedValue({
    items: [{ ref: '22222222-2222-2222-2222-222222222222', name: 'Иванов Иван', department: 'ИТ' }],
    returned: 1,
    truncated: false,
    reason: null,
    as_of: '2026-08-24T10:00:00+05:00',
  });
  (docflowApi.searchDocflowAssignmentDocuments as jest.Mock).mockResolvedValue({
    items: [{ ref: '11111111-1111-1111-1111-111111111111', document_type: 'internal', document_type_label: 'Внутренний документ', title: 'Договор №7', number: 'D-7', date: '2026-08-20' }],
    returned: 1,
    truncated: false,
    reason: null,
    as_of: '2026-08-24T10:00:00+05:00',
  });
  (docflowApi.createDocflowAssignment as jest.Mock).mockResolvedValue({
    command_id: 'assignment-command-1',
    status: 'applied',
    correlation_id: 'corr-assignment',
    error_code: null,
    assignment: { process_ref: 'process-1', task_ref: 'task-2', title: 'HUB-IT TEST · Проверить договор', state: 'Запущено', task_completed: false },
  });
  (docflowApi.getDocflowAssignmentCommand as jest.Mock).mockResolvedValue({
    command_id: 'assignment-command-1',
    status: 'applied',
    correlation_id: 'corr-assignment',
    error_code: null,
    assignment: { process_ref: 'process-1', task_ref: 'task-2', title: 'HUB-IT TEST · Проверить договор', state: 'Запущено', task_completed: false },
  });
  (messengerLinks.openExternalUrl as jest.Mock).mockResolvedValue(true);
  (docflowFiles.downloadNativeDocflowFile as jest.Mock).mockResolvedValue({ uri: 'file://contract.pdf', contentUri: 'content://contract.pdf' });
  (docflowFiles.downloadNativeDocflowPreview as jest.Mock).mockResolvedValue({ uri: 'file://contract-preview.pdf', contentUri: 'content://contract-preview.pdf' });
});

it("clears the prior task when an offline route changes to an uncached task", async () => {
  await writeNativeEntitySnapshot("docflow-task-details", 1, task.ref, enriched);
  mockOfflineMode = true;
  const v = await render(<NativeDocflowDetailScreen taskRef={task.ref} />);
  await waitFor(() => expect(v.getByText(task.title)).toBeTruthy());
  await v.rerender(<NativeDocflowDetailScreen taskRef="never-cached-task-B" />);
  await waitFor(() => expect(v.getByText("Нет подключения и сохранённой карточки 1С ДО.")).toBeTruthy());
  expect(v.queryByText(task.title)).toBeNull();
  expect(docflowApi.getDocflowTask).not.toHaveBeenCalled();
  await v.unmount();
});
it("does not refetch the profile when submitting another online search", async () => {
  const v = await render(<NativeDocflowInboxScreen />);
  await waitFor(() => expect(docflowApi.listDocflowTasks).toHaveBeenCalledTimes(1));
  expect(docflowApi.getDocflowProfile).toHaveBeenCalledTimes(1);
  await fireEvent.changeText(v.getByTestId("native-docflow-search"), "different-query");
  await fireEvent.press(v.getByTestId("native-docflow-search-submit"));
  await waitFor(() => expect(docflowApi.listDocflowTasks).toHaveBeenCalledTimes(2));
  expect(docflowApi.getDocflowProfile).toHaveBeenCalledTimes(1);
  await v.unmount();
});
