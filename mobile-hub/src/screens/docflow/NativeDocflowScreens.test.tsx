import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';
import * as messengerLinks from '../../addressBook/messengerLinks';
import * as docflowApi from '../../api/docflowApi';
import type { DocflowTaskDetail } from '../../api/docflowApi';
import * as docflowFiles from '../../docflow/nativeDocflowFiles';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
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

beforeEach(() => {
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

it('loads the configured inbox and opens an internal native detail route', async () => {
  const view = await render(<NativeDocflowInboxScreen />);
  expect(StyleSheet.flatten(view.getByTestId('native-docflow-scope-tabs').props.style)).toEqual(
    expect.objectContaining({ flexGrow: 0, flexShrink: 0 }),
  );
  await waitFor(() => expect(view.getByText('Согласовать договор')).toBeTruthy());
  expect(docflowApi.listDocflowTasks).toHaveBeenCalledWith({ scope: 'inbox', q: '', limit: 50 });
  fireEvent.press(view.getByTestId(`native-docflow-task-${task.ref}`));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/docflow/[taskRef]',
    params: { taskRef: task.ref },
  });
});

it('tests and saves personal 1C credentials in the native protected form', async () => {
  (docflowApi.getDocflowProfile as jest.Mock).mockResolvedValueOnce({
    configured: false,
    login: null,
    status: 'not_configured',
    last_error_code: null,
    last_verified_at: null,
    updated_at: null,
  });
  const view = await render(<NativeDocflowInboxScreen />);
  await waitFor(() => expect(view.getByText('Подключить')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-docflow-credentials-open'));
  fireEvent.changeText(await view.findByTestId('native-docflow-credential-login'), ' personal.login ');
  await waitFor(() => expect(view.getByTestId('native-docflow-credential-login').props.value).toBe(' personal.login '));
  fireEvent.changeText(view.getByTestId('native-docflow-credential-password'), 'secret-password');
  await waitFor(() => expect(view.getByTestId('native-docflow-credential-password').props.value).toBe('secret-password'));
  await act(async () => { fireEvent.press(view.getByTestId('native-docflow-credentials-test')); });
  await waitFor(() => expect(docflowApi.testDocflowCredentials).toHaveBeenCalledWith('personal.login', 'secret-password'));
  expect(await view.findByText('Подключение к 1С работает. Теперь можно сохранить учётную запись.')).toBeTruthy();
  fireEvent.press(view.getByTestId('native-docflow-credentials-save'));
  await waitFor(() => expect(docflowApi.saveDocflowCredentials).toHaveBeenCalledWith('personal.login', 'secret-password'));
  expect(openPortalPath).not.toHaveBeenCalled();
  await waitFor(() => expect(docflowApi.listDocflowTasks).toHaveBeenCalled());
  await waitFor(() => expect(view.getByText('Согласовать договор')).toBeTruthy());
  view.unmount();
});

it('loads detail progressively and opens its original file natively', async () => {
  const view = await render(<NativeDocflowDetailScreen taskRef={task.ref} />);
  await waitFor(() => expect(view.getByText('Договор №7')).toBeTruthy());
  expect(docflowApi.getDocflowTask).toHaveBeenNthCalledWith(1, task.ref, false);
  expect(docflowApi.getDocflowTask).toHaveBeenNthCalledWith(2, task.ref, true);
  await act(async () => {
    fireEvent.press(view.getByTestId('native-docflow-file-open-file-1'));
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(openNativeFile).toHaveBeenCalledWith(expect.anything(), 'application/pdf'));
  expect(docflowFiles.downloadNativeDocflowPreview).toHaveBeenCalledWith(task.ref, enriched.files[0], expect.objectContaining({ signal: expect.anything(), onProgress: expect.any(Function) }));
  expect(docflowFiles.downloadNativeDocflowFile).not.toHaveBeenCalled();
});

it('applies a server-provided task action natively with a state token and idempotency key', async () => {
  const view = await render(<NativeDocflowDetailScreen taskRef={task.ref} />);
  await waitFor(() => expect(view.getByTestId('native-docflow-action-approve')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-docflow-action-approve'));
  fireEvent.press(await view.findByTestId('native-docflow-action-confirm'));
  await waitFor(() => expect(docflowApi.applyDocflowTaskAction).toHaveBeenCalledWith(
    task.ref,
    { action: 'approve', comment: '', state_token: task.state_token },
    expect.any(String),
  ));
  expect(await view.findByText('1С подтвердила выполнение задания.')).toBeTruthy();
  expect(view.getByText('Завершено')).toBeTruthy();
  expect(openPortalPath).not.toHaveBeenCalled();
});

it('requires a comment for actions that declare it required', async () => {
  const withRequiredComment: DocflowTaskDetail = {
    ...task,
    available_actions: [{ code: 'approve_with_comments', label: 'Согласовать с замечаниями', tone: 'warning', comment_mode: 'required' }],
  };
  (docflowApi.getDocflowTask as jest.Mock).mockReset();
  (docflowApi.getDocflowTask as jest.Mock).mockResolvedValue(withRequiredComment);
  const view = await render(<NativeDocflowDetailScreen taskRef={task.ref} />);
  await waitFor(() => expect(view.getByTestId('native-docflow-action-approve_with_comments')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-docflow-action-approve_with_comments'));
  expect(docflowKeyboardAvoidingBehavior('android')).toBe('height');
  expect(docflowKeyboardAvoidingBehavior('ios')).toBe('padding');
  expect(await view.findByTestId('native-docflow-action-keyboard-avoiding')).toBeTruthy();
  expect(await view.findByTestId('native-docflow-action-footer')).toBeTruthy();
  fireEvent.press(await view.findByTestId('native-docflow-action-confirm'));
  expect(await view.findByText('Введите комментарий — без него действие выполнить нельзя.')).toBeTruthy();
  expect(docflowApi.applyDocflowTaskAction).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByTestId('native-docflow-action-comment'), 'Есть замечание');
  await waitFor(() => expect(view.getByTestId('native-docflow-action-comment').props.value).toBe('Есть замечание'));
  fireEvent.press(view.getByTestId('native-docflow-action-confirm'));
  await waitFor(() => expect(docflowApi.applyDocflowTaskAction).toHaveBeenCalledWith(
    task.ref,
    { action: 'approve_with_comments', comment: 'Есть замечание', state_token: task.state_token },
    expect.any(String),
  ));
});

it('keeps a pending 1C command visible and lets the user verify it', async () => {
  (docflowApi.applyDocflowTaskAction as jest.Mock).mockResolvedValueOnce({
    command_id: 'cmd-pending',
    status: 'pending',
    correlation_id: 'corr-pending',
    error_code: null,
    task: null,
  });
  const view = await render(<NativeDocflowDetailScreen taskRef={task.ref} />);
  await waitFor(() => expect(view.getByTestId('native-docflow-action-approve')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-docflow-action-approve'));
  fireEvent.press(await view.findByTestId('native-docflow-action-confirm'));
  await waitFor(() => expect(view.getByTestId('native-docflow-command-check')).toBeTruthy());
  fireEvent.press(view.getByTestId('native-docflow-command-check'));
  await waitFor(() => expect(docflowApi.getDocflowCommand).toHaveBeenCalledWith('cmd-pending'));
  expect(await view.findByText('1С подтвердила выполнение задания.')).toBeTruthy();
});

it('opens the exact validated 1C URL when a digital signature is required', async () => {
  const signedTask: DocflowTaskDetail = {
    ...task,
    available_actions: [],
    state_token: null,
    requires_digital_signature: true,
    action_unavailable_reason: 'Для задания требуется электронная подпись.',
    open_in_1c_url: 'https://docflow.example/1c/task-1',
  };
  (docflowApi.getDocflowTask as jest.Mock).mockReset();
  (docflowApi.getDocflowTask as jest.Mock).mockResolvedValue(signedTask);
  const view = await render(<NativeDocflowDetailScreen taskRef={task.ref} />);
  fireEvent.press(await view.findByText('Выполнить в 1С'));
  await waitFor(() => expect(messengerLinks.openExternalUrl).toHaveBeenCalledWith(signedTask.open_in_1c_url));
  expect(openPortalPath).not.toHaveBeenCalled();
});

it('creates a server-enabled assignment natively from a selected document and assignee', async () => {
  const view = await render(<NativeDocflowAssignmentScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(docflowApi.searchDocflowAssignmentAssignees).toHaveBeenCalledWith('', 20);
  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-docflow-assignment-document-query'), 'Договор');
    await Promise.resolve();
  });
  expect(view.getByTestId('native-docflow-assignment-document-query').props.value).toBe('Договор');
  await act(async () => {
    fireEvent.press(view.getByTestId('native-docflow-assignment-document-search'));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(docflowApi.searchDocflowAssignmentDocuments).toHaveBeenCalledWith('Договор', 20);
  await act(async () => {
    fireEvent.press(view.getByTestId('native-docflow-assignment-document-11111111-1111-1111-1111-111111111111'));
    fireEvent.press(view.getByTestId('native-docflow-assignment-assignee-22222222-2222-2222-2222-222222222222'));
    fireEvent.changeText(view.getByTestId('native-docflow-assignment-title'), 'HUB-IT TEST · Проверить договор');
    fireEvent.changeText(view.getByTestId('native-docflow-assignment-description'), 'Проверьте условия договора.');
    await Promise.resolve();
  });
  expect(view.getByTestId('native-docflow-assignment-description').props.value).toBe('Проверьте условия договора.');
  await act(async () => {
    fireEvent.press(view.getByTestId('native-docflow-assignment-submit'));
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(docflowApi.createDocflowAssignment).toHaveBeenCalledWith(
    expect.objectContaining({
      document_type: 'internal',
      document_ref: '11111111-1111-1111-1111-111111111111',
      assignee_ref: '22222222-2222-2222-2222-222222222222',
      title: 'HUB-IT TEST · Проверить договор',
      description: 'Проверьте условия договора.',
    }),
    expect.any(String),
  ));
  expect(view.getByText('Поручение создано')).toBeTruthy();
  view.unmount();
});

it('honors the assignment capability gate without searching 1C data', async () => {
  (docflowApi.getDocflowAssignmentCapability as jest.Mock).mockReset();
  (docflowApi.getDocflowAssignmentCapability as jest.Mock).mockResolvedValue({
    enabled: false,
    reason: 'Создание доступно только пилотной группе.',
    document_types: [],
    test_only: true,
    required_title_prefix: 'HUB-IT TEST',
  });
  const view = await render(<NativeDocflowAssignmentScreen />);
  expect(await view.findByText('Создание доступно только пилотной группе.')).toBeTruthy();
  expect(docflowApi.searchDocflowAssignmentAssignees).not.toHaveBeenCalled();
  expect(docflowApi.searchDocflowAssignmentDocuments).not.toHaveBeenCalled();
});

it('does not request 1C without docflow.read', async () => {
  mockPermissions = [];
  const inbox = await render(<NativeDocflowInboxScreen />);
  await waitFor(() => expect(inbox.getByText('Нет доступа')).toBeTruthy());
  expect(docflowApi.getDocflowProfile).not.toHaveBeenCalled();
  inbox.unmount();
  const detail = await render(<NativeDocflowDetailScreen taskRef={task.ref} />);
  await waitFor(() => expect(detail.getByText('Нет доступа')).toBeTruthy());
  expect(docflowApi.getDocflowTask).not.toHaveBeenCalled();
});
