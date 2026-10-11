import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { useState } from 'react';

import TasksCreateDialog from './TasksCreateDialog';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import useTaskEditForm from '../../../pages/tasks/hooks/useTaskEditForm';

const hubTasksMock = vi.hoisted(() => ({ getTask: vi.fn(), updateTask: vi.fn() }));
const hubTaskFilesMock = vi.hoisted(() => ({ uploadTaskAttachment: vi.fn() }));

vi.mock('../../../api/hubTasks', () => ({ default: hubTasksMock }));
vi.mock('../../../api/hubTaskFiles', () => ({ default: hubTaskFilesMock }));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);
const noop = () => {};

const createBaseData = {
  title: 'Проверка чипов',
  description: '',
  assignee_user_ids: ['1'],
  assignment_mode: 'shared',
  observer_user_ids: [],
  controller_user_id: '',
  project_id: 'project-1',
  object_id: '',
  protocol_date: '2026-06-01',
  due_at: '',
  priority: 'normal',
  department_id: '',
  visibility_scope: 'private',
  email_deadline_remind_mode: 'default',
  email_deadline_remind_hours: 24,
};

const editBaseData = {
  id: 'task-1',
  title: 'Существующая задача',
  description: '',
  assignee_user_ids: ['1'],
  controller_user_id: '',
  observer_user_ids: [],
  project_id: 'project-1',
  object_id: '',
  protocol_date: '2026-06-01',
  due_at: '',
  priority: 'normal',
  department_id: '',
  visibility_scope: 'private',
  email_deadline_remind_mode: 'default',
  email_deadline_remind_hours: 24,
};

const sharedProps = {
  ui,
  onClose: noop,
  isMobile: false,
  getAssigneePickerOptions: () => [],
  renderTaskUserOption: () => null,
  renderTaskUserOptionMultiple: () => null,
  renderTaskObserverTags: () => null,
  renderTaskUserTags: () => null,
  taskUserAutocompleteSlotProps: {},
  assigneeAutocompleteProps: {},
  observerAutocompleteProps: {},
  controllers: [],
  departments: [],
  activeTaskProjects: [{ id: 'project-1', name: 'Проект', is_active: true }],
  createDuePresets: [],
};

function CreateHarness({ onSubmit, selectedCreateObservers = [] }) {
  const [createData, setCreateData] = useState(createBaseData);
  const [sections, setSections] = useState({});
  return (
    <ThemeProvider theme={theme}>
      <TasksCreateDialog
        {...sharedProps}
        open
        mode="create"
        createData={createData}
        setCreateData={setCreateData}
        createOptionalSections={sections}
        onOpenOptionalSection={(key) => setSections((prev) => ({ ...prev, [key]: !prev[key] }))}
        onCreate={() => onSubmit(createData)}
        onCreateDescriptionDraftChange={noop}
        effectiveCreateProjectId="project-1"
        effectiveCreateProject={{ id: 'project-1', name: 'Проект' }}
        selectedCreateObservers={selectedCreateObservers}
        createFiles={[]}
        createChecklistItems={[]}
      />
    </ThemeProvider>
  );
}

function EditHarness({ onSave, selectedEditObservers = [], filesEnabled = true }) {
  const [editData, setEditData] = useState(editBaseData);
  const [editFiles, setEditFiles] = useState([]);
  return (
    <ThemeProvider theme={theme}>
      <TasksCreateDialog
        {...sharedProps}
        open
        mode="edit"
        editData={editData}
        setEditData={setEditData}
        onSave={() => onSave(editData)}
        onEditDescriptionDraftChange={noop}
        selectedEditAssignees={[]}
        selectedEditController={null}
        selectedEditObservers={selectedEditObservers}
        selectedEditDepartment={null}
        editProjectObjects={[]}
        editDueLabel="Без срока"
        {...(filesEnabled ? {
          editFiles,
          onAddEditFiles: (list) => setEditFiles((prev) => [...prev, ...Array.from(list)]),
          onRemoveEditFile: (index) => setEditFiles((prev) => prev.filter((_, i) => i !== index)),
        } : {})}
      />
    </ThemeProvider>
  );
}

// Реальный useTaskEditForm + диалог: проверяем сохранение и загрузку файлов через действия пользователя.
function EditFlowHarness({ setError, refreshTasksAndDetails, applyTaskUpdate }) {
  const [open, setOpen] = useState(false);
  const form = useTaskEditForm({
    setError,
    refreshTasksAndDetails,
    applyTaskUpdate,
    controllers: [],
    departments: [],
    activeTaskObjects: [],
    getAssigneeById: () => null,
    mergeAssigneesIntoCache: noop,
    clearAssigneeSearchResults: noop,
    setObserverSearchInput: noop,
    resetTaskUserSearchInputs: noop,
    editOpen: open,
    setEditOpen: setOpen,
  });
  return (
    <ThemeProvider theme={theme}>
      <button type="button" onClick={() => form.openEditTask({ id: 'task-7', title: 'Существующая задача' })}>
        Открыть задачу
      </button>
      {open ? (
        <TasksCreateDialog
          {...sharedProps}
          open
          mode="edit"
          onClose={() => setOpen(false)}
          editData={form.editData}
          setEditData={form.setEditData}
          editSaving={form.editSaving}
          editLoading={form.editLoading}
          onSave={form.handleSaveEdit}
          onEditDescriptionDraftChange={form.handleEditDescriptionDraftChange}
          selectedEditAssignees={form.selectedEditAssignees}
          selectedEditController={null}
          selectedEditObservers={[]}
          selectedEditDepartment={null}
          editProjectObjects={[]}
          editDueLabel="Без срока"
          editFiles={form.editFiles}
          onAddEditFiles={form.handleAddEditFiles}
          onRemoveEditFile={form.handleRemoveEditFile}
        />
      ) : null}
    </ThemeProvider>
  );
}

const makeFile = (name) => new File(['content'], name, { type: 'application/pdf' });

const pickFiles = (files) => {
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files } });
};

const remoteTask = {
  id: 'task-7',
  title: 'Существующая задача',
  description: '',
  assignee_user_id: 1,
  assignee_user_ids: [1],
  project_id: 'project-1',
  object_id: '',
  protocol_date: '2026-06-01',
  due_at: null,
  priority: 'normal',
  department_id: '',
  visibility_scope: 'private',
  controller_user_id: null,
  observer_user_ids: [],
  assignees: [],
  observers: [],
};

describe('TasksCreateDialog: наблюдатели', () => {
  it('на десктопе чип «Наблюдатели» виден, а поле раскрывается только по клику', () => {
    render(<CreateHarness onSubmit={noop} />);

    expect(screen.getByText('Наблюдатели')).toBeTruthy();
    expect(screen.queryByLabelText('Наблюдатели')).toBeNull();

    fireEvent.click(screen.getByText('Наблюдатели'));

    expect(screen.getByLabelText('Наблюдатели')).toBeTruthy();
  });

  it('панель наблюдателей открыта сразу, если наблюдатели уже выбраны (edit)', () => {
    render(<EditHarness onSave={noop} selectedEditObservers={[{ id: '2', full_name: 'Иван Петров', username: 'ipetrov' }]} />);

    expect(screen.getByLabelText('Наблюдатели')).toBeTruthy();
  });
});

describe('TasksCreateDialog: приоритет', () => {
  it('клик по чипу открывает список из четырёх приоритетов', () => {
    render(<CreateHarness onSubmit={noop} />);

    fireEvent.click(screen.getByText('В приоритете'));

    const items = screen.getAllByRole('menuitem').map((node) => node.textContent);
    expect(items).toEqual(['Низкий', 'Обычный', 'Высокий', 'Срочный']);
  });

  it('выбор «Срочный» в создании попадает в данные задачи и меняет подпись чипа', async () => {
    const onSubmit = vi.fn();
    render(<CreateHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('В приоритете'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Срочный' }));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByText('Срочный')).toBeTruthy();

    fireEvent.click(screen.getByText('Создать задачу'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].priority).toBe('urgent');
  });

  it('выбор «Низкий» в редактировании попадает в данные при сохранении', async () => {
    const onSave = vi.fn();
    render(<EditHarness onSave={onSave} />);

    fireEvent.click(screen.getByText('В приоритете'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Низкий' }));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(screen.getByText('Сохранить изменения'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].priority).toBe('low');
  });
});

describe('TasksCreateDialog: файлы в редактировании', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('в edit есть чип «Файлы», чек-листа нет', () => {
    render(<EditHarness onSave={noop} />);

    expect(screen.getByText('Файлы')).toBeTruthy();
    expect(screen.queryByText('Чек-лист')).toBeNull();
  });

  it('без обработчиков файлов (например, из TaskActionDialogs) чипа «Файлы» нет', () => {
    render(<EditHarness onSave={noop} filesEnabled={false} />);

    expect(screen.queryByText('Файлы')).toBeNull();
  });

  it('выбранный файл появляется в списке, счётчик обновляется, есть подсказка про сохранение', () => {
    render(<EditHarness onSave={noop} />);

    fireEvent.click(screen.getByText('Файлы'));
    expect(screen.getByText('Файлы будут добавлены к задаче после сохранения')).toBeTruthy();

    pickFiles([makeFile('акт.pdf')]);

    expect(screen.getByText('акт.pdf')).toBeTruthy();
    expect(screen.getAllByText('Файлы: 1').length).toBeGreaterThan(0);
  });

  it('удаление выбранного файла убирает его из списка', () => {
    render(<EditHarness onSave={noop} />);

    fireEvent.click(screen.getByText('Файлы'));
    pickFiles([makeFile('акт.pdf')]);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать файл акт.pdf' }));

    expect(screen.queryByText('акт.pdf')).toBeNull();
  });

  it('сохранение загружает выбранный файл в редактируемую задачу и закрывает диалог', async () => {
    hubTasksMock.getTask.mockResolvedValue(remoteTask);
    hubTasksMock.updateTask.mockResolvedValue(remoteTask);
    hubTaskFilesMock.uploadTaskAttachment.mockResolvedValue({ id: 'att-1' });
    const setError = vi.fn();
    const refresh = vi.fn();
    const applyTaskUpdate = vi.fn();
    render(<EditFlowHarness setError={setError} refreshTasksAndDetails={refresh} applyTaskUpdate={applyTaskUpdate} />);

    fireEvent.click(screen.getByText('Открыть задачу'));
    await screen.findByDisplayValue('Существующая задача');
    fireEvent.click(screen.getByText('Файлы'));
    const file = makeFile('акт.pdf');
    pickFiles([file]);
    fireEvent.click(screen.getByText('Сохранить изменения'));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Закрыть редактирование задачи' })).toBeNull());
    expect(hubTasksMock.updateTask).toHaveBeenCalledWith('task-7', expect.objectContaining({ title: 'Существующая задача' }));
    expect(hubTaskFilesMock.uploadTaskAttachment).toHaveBeenCalledTimes(1);
    expect(hubTaskFilesMock.uploadTaskAttachment).toHaveBeenCalledWith({ taskId: 'task-7', file });
    expect(refresh).toHaveBeenCalledWith('task-7');
    expect(setError).not.toHaveBeenCalled();
  });

  it('ошибка загрузки не отменяет сохранение: показывает сообщение, диалог остаётся с неудачным файлом', async () => {
    hubTasksMock.getTask.mockResolvedValue(remoteTask);
    hubTasksMock.updateTask.mockResolvedValue(remoteTask);
    hubTaskFilesMock.uploadTaskAttachment.mockRejectedValue(new Error('Файл слишком большой'));
    const setError = vi.fn();
    render(<EditFlowHarness setError={setError} refreshTasksAndDetails={vi.fn()} applyTaskUpdate={vi.fn()} />);

    fireEvent.click(screen.getByText('Открыть задачу'));
    await screen.findByDisplayValue('Существующая задача');
    fireEvent.click(screen.getByText('Файлы'));
    pickFiles([makeFile('большой.pdf')]);
    fireEvent.click(screen.getByText('Сохранить изменения'));

    await waitFor(() => expect(setError).toHaveBeenCalledWith(
      'Изменения сохранены, но часть файлов не загрузилась: большой.pdf',
    ));
    expect(hubTasksMock.updateTask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Закрыть редактирование задачи' })).toBeTruthy();
    expect(screen.getByText('большой.pdf')).toBeTruthy();
  });
});
