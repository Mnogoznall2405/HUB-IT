import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksCreateDialog from './TasksCreateDialog';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import { createInitialTaskDraft } from '../../../pages/tasks/taskCreateModel';

vi.mock('./LocalTaskDescriptionField', () => ({
  default: ({ placeholder }) => <textarea aria-label={placeholder} />,
}));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const baseCreateData = {
  ...createInitialTaskDraft(),
  title: 'Новая задача',
  assignee_user_ids: ['1'],
  project_id: 'project-1',
  protocol_date: '2026-06-01',
};

const noop = () => {};

const renderDialog = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <TasksCreateDialog
      open
      onClose={noop}
      ui={ui}
      createData={baseCreateData}
      setCreateData={noop}
      onCreate={noop}
      onCreateDescriptionDraftChange={noop}
      onOpenOptionalSection={noop}
      createDueAnchorRef={{ current: null }}
      onOpenDuePicker={noop}
      getAssigneePickerOptions={() => []}
      onChangeAssigneeIds={noop}
      onChangeObserverIds={noop}
      renderTaskUserOption={() => null}
      renderTaskUserOptionMultiple={() => null}
      renderTaskUserTags={() => null}
      renderTaskObserverTags={() => null}
      taskUserAutocompleteSlotProps={{}}
      assigneeAutocompleteProps={{
        filterOptions: (options) => options,
        inputValue: '',
        onInputChange: noop,
      }}
      activeTaskProjects={[{ id: 'project-1', name: 'Проект Север' }]}
      effectiveCreateProjectId="project-1"
      setCreateProjectName={noop}
      onCreateProject={noop}
      onAddChecklistItem={noop}
      onUpdateChecklistItem={noop}
      onRemoveChecklistItem={noop}
      onAddCreateFiles={noop}
      onRemoveCreateFile={noop}
      {...props}
    />
  </ThemeProvider>,
);

describe('TasksCreateDialog', () => {
  it('renders create form fields when open', () => {
    renderDialog();
    expect(screen.getByPlaceholderText('Название задачи')).toBeInTheDocument();
    expect(screen.getByLabelText('Описание')).toBeInTheDocument();
    expect(screen.getByTestId('create-due-open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Создать/ })).toBeEnabled();
  });

  it('disables create when title is too short', () => {
    renderDialog({
      createData: { ...baseCreateData, title: 'ab' },
    });
    expect(screen.getByRole('button', { name: /^Создать/ })).toBeDisabled();
  });

  it('opens due picker from create dialog', () => {
    const onOpenDuePicker = vi.fn();
    renderDialog({ onOpenDuePicker });
    fireEvent.click(screen.getByTestId('create-due-open'));
    expect(onOpenDuePicker).toHaveBeenCalledTimes(1);
  });
});
