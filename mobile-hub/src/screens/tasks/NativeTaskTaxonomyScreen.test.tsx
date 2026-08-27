import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as taskApi from '../../api/taskApi';
import { NativeTaskTaxonomyScreen } from './NativeTaskTaxonomyScreen';

let mockPermissions = ['tasks.write'];

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: false,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({
    preferences: jest.requireActual('../../preferences/preferenceNormalizers').DEFAULT_PREFERENCES,
  }),
}));

jest.mock('../../api/taskApi', () => ({
  getTaskProjects: jest.fn(),
  getTaskObjects: jest.fn(),
  createTaskProject: jest.fn(),
  createTaskObject: jest.fn(),
  updateTaskProject: jest.fn(),
  updateTaskObject: jest.fn(),
}));

describe('NativeTaskTaxonomyScreen', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = ['tasks.write'];
    (taskApi.getTaskProjects as jest.Mock).mockResolvedValue([{ id: 'p1', name: 'Проект', code: 'P', is_active: true }]);
    (taskApi.getTaskObjects as jest.Mock).mockResolvedValue([{ id: 'o1', project_id: 'p1', name: 'Серверная', code: 'S', is_active: true }]);
    (taskApi.updateTaskProject as jest.Mock).mockImplementation(async (id, payload) => ({ id, ...payload }));
    (taskApi.updateTaskObject as jest.Mock).mockImplementation(async (id, payload) => ({ id, ...payload }));
    (taskApi.createTaskProject as jest.Mock).mockResolvedValue({ id: 'p2', name: 'Новый проект', is_active: true });
    (taskApi.createTaskObject as jest.Mock).mockResolvedValue({ id: 'o2', project_id: 'p1', name: 'Новый объект', is_active: true });
  });

  it('edits and safely deactivates a project', async () => {
    const view = await render(<NativeTaskTaxonomyScreen />);
    await waitFor(() => expect(view.getByTestId('native-task-project-edit-open-p1')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('native-task-project-edit-open-p1')); });
    await act(async () => { fireEvent.changeText(view.getByTestId('native-task-project-edit-p1-name'), 'Проект 2'); });
    await waitFor(() => expect(view.getByTestId('native-task-project-edit-p1-name').props.value).toBe('Проект 2'));
    await act(async () => { fireEvent.press(view.getByTestId('native-task-project-edit-p1-active')); });
    await waitFor(() => expect(view.getByTestId('native-task-project-edit-p1-active').props.accessibilityState.checked).toBe(false));
    await act(async () => { fireEvent.press(view.getByTestId('native-task-project-save-p1')); });
    await waitFor(() => expect(taskApi.updateTaskProject).toHaveBeenCalledWith('p1', expect.objectContaining({
      name: 'Проект 2',
      is_active: false,
    })));
  });

  it('creates an object inside the selected project', async () => {
    const view = await render(<NativeTaskTaxonomyScreen />);
    await waitFor(() => expect(view.getByTestId('native-task-object-new-name')).toBeTruthy());
    await act(async () => { fireEvent.changeText(view.getByTestId('native-task-object-new-name'), 'Новый объект'); });
    await waitFor(() => expect(view.getByTestId('native-task-object-new-name').props.value).toBe('Новый объект'));
    await act(async () => { fireEvent.press(view.getByTestId('native-task-object-create')); });
    await waitFor(() => expect(taskApi.createTaskObject).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p1',
      name: 'Новый объект',
    })));
  });

  it('does not load taxonomy without tasks.write', async () => {
    mockPermissions = [];
    const view = await render(<NativeTaskTaxonomyScreen />);
    expect(view.getByText('Нет доступа')).toBeTruthy();
    expect(taskApi.getTaskProjects).not.toHaveBeenCalled();
  });
});
