import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksEditDialog from './TasksEditDialog';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

vi.mock('./LocalTaskMarkdownEditor', () => ({
  default: ({ label }) => <textarea aria-label={label} />,
}));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const baseEditData = {
  id: 'task-1',
  title: 'Тестовая задача',
  description: 'Описание',
  due_at: '2026-06-20T19:00',
  protocol_date: '2026-06-01',
  priority: 'normal',
  project_id: 'project-1',
  object_id: '',
  assignee_user_id: '1',
  controller_user_id: '',
  observer_user_ids: [],
  department_id: '',
  visibility_scope: 'private',
  email_deadline_remind_mode: 'default',
  email_deadline_remind_hours: 24,
};

const noop = () => {};

const renderDialog = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <TasksEditDialog
      open
      onClose={noop}
      ui={ui}
      editData={baseEditData}
      setEditData={noop}
      onSave={noop}
      onEditDescriptionDraftChange={noop}
      onAiTransform={noop}
      getAssigneePickerOptions={() => []}
      onSingleAssigneeAutocompleteChange={(handler) => (_, value) => handler(value)}
      renderTaskUserOption={() => null}
      renderTaskUserOptionMultiple={() => null}
      renderTaskObserverTags={() => null}
      taskUserAutocompleteSlotProps={{}}
      assigneeAutocompleteProps={{
        filterOptions: (options) => options,
        inputValue: '',
        onInputChange: noop,
      }}
      getAssigneeAutocompleteInputValue={() => ''}
      createDuePresets={[]}
      editDueLabel="20.06 в 19:00"
      onEditDueCustomOpenChange={noop}
      onSelectEditDuePreset={noop}
      onEditDueAtChange={noop}
      {...props}
    />
  </ThemeProvider>,
);

describe('TasksEditDialog', () => {
  it('renders edit form fields when open', () => {
    renderDialog({
      activeTaskProjects: [{ id: 'project-1', name: 'Проект Север' }],
    });
    expect(screen.getByText('Редактирование задачи')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Тестовая задача')).toBeInTheDocument();
    expect(screen.getByLabelText('Описание')).toBeInTheDocument();
    expect(screen.getByTestId('edit-due-panel')).toBeInTheDocument();
    expect(screen.getByTestId('edit-email-remind-block')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeEnabled();
  });

  it('disables save when title is too short', () => {
    renderDialog({
      editData: { ...baseEditData, title: 'ab' },
    });
    expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeDisabled();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
