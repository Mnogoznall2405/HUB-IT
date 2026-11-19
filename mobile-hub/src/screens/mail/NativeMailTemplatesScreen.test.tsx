import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as mailApi from '../../api/mailApi';
import { NativeMailTemplatesScreen } from './NativeMailTemplatesScreen';

let mockPermissions = ['settings.users.manage'];
let mockOfflineMode = false;
let mockUserId = 1;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: mockUserId, username: 'manager', role: 'admin', permissions: mockPermissions },
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));

jest.mock('../../api/mailApi', () => ({
  listMailTemplates: jest.fn(),
  createMailTemplate: jest.fn(),
  updateMailTemplate: jest.fn(),
  deleteMailTemplate: jest.fn(),
}));

const templates = [
  {
    id: 'tpl-1',
    code: 'access',
    title: 'Доступ к системе',
    category: 'Доступы',
    is_active: true,
    subject_template: 'Заявка: {{system}}',
    body_template_md: 'Текст заявки',
    fields: [
      { key: 'system', label: 'Система', type: 'text', required: true, placeholder: '', default_value: '1С', options: [] },
      { key: 'comment', label: 'Комментарий', type: 'text', required: false, placeholder: '', default_value: '', options: [] },
    ],
  },
  { id: 'tpl-2', code: 'old', title: '', category: '', is_active: false, subject_template: 'x', body_template_md: '', fields: [] },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['settings.users.manage'];
  mockOfflineMode = false;
  mockUserId = 1;
  (mailApi.listMailTemplates as jest.Mock).mockResolvedValue(templates);
  (mailApi.createMailTemplate as jest.Mock).mockImplementation(async (payload) => ({ id: 'tpl-new', is_active: true, ...payload }));
  (mailApi.updateMailTemplate as jest.Mock).mockImplementation(async (id, payload) => ({ id, is_active: true, ...payload }));
  (mailApi.deleteMailTemplate as jest.Mock).mockResolvedValue({ ok: true });
});

it('denies the screen without settings.users.manage', async () => {
  mockPermissions = [];
  const view = await render(<NativeMailTemplatesScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(view.getByText('Нужно право settings.users.manage.')).toBeTruthy();
  expect(mailApi.listMailTemplates).not.toHaveBeenCalled();
});

it('lists templates with inactive badge and required-field meta', async () => {
  const view = await render(<NativeMailTemplatesScreen />);
  await waitFor(() => expect(mailApi.listMailTemplates).toHaveBeenCalledWith({ include_inactive: true }));
  const row = await view.findByTestId('native-mail-template-row-tpl-1');
  expect(row).toBeTruthy();
  expect(view.getByText('Доступ к системе')).toBeTruthy();
  expect(view.getByText(/Обязательных полей: 1/)).toBeTruthy();
  expect(view.getByTestId('native-mail-template-row-tpl-2')).toBeTruthy();
  expect(view.getByText('неактивен')).toBeTruthy();
});

it('creates a template through the editor and refetches the list', async () => {
  const view = await render(<NativeMailTemplatesScreen />);
  await view.findByTestId('native-mail-template-row-tpl-1');

  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-create')); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-code'), 'NEWCODE'); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-title'), 'Новая заявка'); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-subject'), 'Тема {{system}}'); });

  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-field-add')); });
  expect(view.getByTestId('native-mail-template-field-0-key').props.value).toBe('field_1');
  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-field-0-type-select')); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-field-0-options'), 'Один\nДва'); });

  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-save')); });

  await waitFor(() => expect(mailApi.createMailTemplate).toHaveBeenCalledTimes(1));
  expect(mailApi.createMailTemplate).toHaveBeenCalledWith({
    code: 'newcode',
    title: 'Новая заявка',
    category: '',
    subject_template: 'Тема {{system}}',
    body_template_md: '',
    fields: [
      { key: 'field_1', label: 'Поле 1', type: 'select', required: true, placeholder: '', default_value: '', options: ['Один', 'Два'] },
    ],
  });
  await waitFor(() => expect(mailApi.listMailTemplates).toHaveBeenCalledTimes(2));
  expect(await view.findByText('Шаблон создан.')).toBeTruthy();
});

it('prefills the editor from a row and patches the template', async () => {
  const view = await render(<NativeMailTemplatesScreen />);
  await view.findByTestId('native-mail-template-row-tpl-1');

  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-row-tpl-1')); });

  expect(view.getByTestId('native-mail-template-code').props.value).toBe('access');
  expect(view.getByTestId('native-mail-template-title').props.value).toBe('Доступ к системе');
  expect(view.getByTestId('native-mail-template-subject').props.value).toBe('Заявка: {{system}}');
  expect(view.getByTestId('native-mail-template-body').props.value).toBe('Текст заявки');
  expect(view.getByTestId('native-mail-template-field-0-key').props.value).toBe('system');
  expect(view.getByTestId('native-mail-template-field-1-key').props.value).toBe('comment');
  expect(view.getByTestId('native-mail-template-preview').props.children).toContain('Заявка: 1С');

  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-title'), 'Доступ к CRM'); });
  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-save')); });

  await waitFor(() => expect(mailApi.updateMailTemplate).toHaveBeenCalledTimes(1));
  expect(mailApi.updateMailTemplate).toHaveBeenCalledWith('tpl-1', expect.objectContaining({
    code: 'access',
    title: 'Доступ к CRM',
    subject_template: 'Заявка: {{system}}',
    fields: expect.arrayContaining([
      expect.objectContaining({ key: 'system', default_value: '1С' }),
      expect.objectContaining({ key: 'comment', required: false }),
    ]),
  }));
  expect(mailApi.createMailTemplate).not.toHaveBeenCalled();
  expect(await view.findByText('Шаблон обновлен.')).toBeTruthy();
});

it('deactivates a template only after the destructive confirm', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
  const view = await render(<NativeMailTemplatesScreen />);
  await view.findByTestId('native-mail-template-row-tpl-1');
  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-row-tpl-1')); });
  await view.findByTestId('native-mail-template-delete');

  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-delete')); });

  expect(alert).toHaveBeenCalledWith(
    'Удалить шаблон «Доступ к системе»?',
    expect.any(String),
    expect.any(Array),
  );
  await waitFor(() => expect(mailApi.deleteMailTemplate).toHaveBeenCalledWith('tpl-1'));
  expect(await view.findByText('Шаблон деактивирован.')).toBeTruthy();
  expect(view.queryByTestId('native-mail-template-delete')).toBeNull();
  alert.mockRestore();
});

it('blocks the request when validation fails', async () => {
  const view = await render(<NativeMailTemplatesScreen />);
  await view.findByTestId('native-mail-template-row-tpl-1');
  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-create')); });

  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-save')); });

  expect(await view.findByText('Укажите код шаблона.')).toBeTruthy();
  expect(mailApi.createMailTemplate).not.toHaveBeenCalled();
  expect(mailApi.updateMailTemplate).not.toHaveBeenCalled();
});

it('disables create and save in offline mode and never loads', async () => {
  mockOfflineMode = true;
  const view = await render(<NativeMailTemplatesScreen />);
  await waitFor(() => expect(view.getByText('Автономный режим: управление шаблонами недоступно.')).toBeTruthy());
  expect(mailApi.listMailTemplates).not.toHaveBeenCalled();
  expect(view.getByTestId('native-mail-template-create').props.accessibilityState.disabled).toBe(true);
});

it('sends create exactly once while a save is in flight', async () => {
  let finish!: (value: unknown) => void;
  (mailApi.createMailTemplate as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<NativeMailTemplatesScreen />);
  await view.findByTestId('native-mail-template-row-tpl-1');
  await act(async () => { fireEvent.press(view.getByTestId('native-mail-template-create')); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-code'), 'once'); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-title'), 'Раз'); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-mail-template-subject'), 'Тема'); });

  const save = view.getByTestId('native-mail-template-save');
  await fireEvent.press(save);
  await fireEvent.press(save);
  await act(async () => { finish({ id: 'tpl-new', is_active: true }); });

  await waitFor(() => expect(mailApi.createMailTemplate).toHaveBeenCalledTimes(1));
  expect(await view.findByText('Шаблон создан.')).toBeTruthy();
});
