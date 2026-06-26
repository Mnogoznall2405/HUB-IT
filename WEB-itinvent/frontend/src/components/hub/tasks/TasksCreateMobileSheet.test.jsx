import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksCreateMobileSheet from './TasksCreateMobileSheet';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

vi.mock('./MobileCreateDescriptionEditor', () => ({
  default: ({ onDone }) => (
    <div>
      <textarea data-testid="create-description-mobile-input" aria-label="Описание" />
      <button type="button" data-testid="create-description-mobile-done" onClick={onDone}>Готово</button>
    </div>
  ),
}));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);
const noop = () => {};

const baseBodyProps = {
  createOpen: true,
  ui,
  theme,
  createDescriptionRef: { current: '' },
  createDescriptionPreview: '',
  createData: {
    title: '',
    description: '',
    priority: 'normal',
    assignee_user_ids: [],
    observer_user_ids: [],
    project_id: 'project-1',
    department_id: '',
    visibility_scope: 'private',
  },
  setCreateData: vi.fn(),
  setCreateOptionalSections: vi.fn(),
  setCreateMobileSheet: vi.fn(),
  createSaving: false,
  createFiles: [],
  createChecklistItems: [],
  effectiveCreateProjectId: 'project-1',
  activeTaskProjects: [{ id: 'project-1', name: 'Проект' }],
  controllers: [],
  departments: [],
  taskUsersLoading: false,
  handleCreateDescriptionDraftChange: noop,
  handleCloseCreateMobileSheet: noop,
  handleAddCreateFiles: noop,
  handleChangeCreateAssigneeIds: noop,
  handleClearCreateAssignees: noop,
  searchCreateAssignees: vi.fn(async () => []),
  resolveCreateAssignees: vi.fn(async () => []),
  handleRemoveCreateFile: noop,
  handleAddChecklistItem: noop,
  handleUpdateChecklistItem: noop,
  handleRemoveChecklistItem: noop,
  createProjectName: '',
  setCreateProjectName: noop,
  handleCreateProjectFromTaskDialog: noop,
  createProjectSaving: false,
  handleChangeCreateControllerId: noop,
  handleClearCreateController: noop,
  taskUsersLoadError: '',
  loadTaskUserDirectories: noop,
  handleChangeCreateObserverIds: noop,
  handleClearCreateObservers: noop,
  selectedCreateController: null,
  renderTaskUserOption: () => null,
  taskUserAutocompleteSlotProps: {},
  selectedCreateDepartment: null,
};

const renderSheet = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <TasksCreateMobileSheet
      open
      sheet="priority"
      onClose={noop}
      ui={ui}
      theme={theme}
      bodyProps={baseBodyProps}
      {...props}
    />
  </ThemeProvider>,
);

describe('TasksCreateMobileSheet', () => {
  it('renders priority sheet and updates create data', () => {
    const setCreateData = vi.fn((updater) => {
      if (typeof updater === 'function') {
        updater(baseBodyProps.createData);
      }
    });
    const setCreateOptionalSections = vi.fn();
    const setCreateMobileSheet = vi.fn();

    renderSheet({
      bodyProps: {
        ...baseBodyProps,
        setCreateData,
        setCreateOptionalSections,
        setCreateMobileSheet,
      },
    });

    const sheet = screen.getByTestId('create-mobile-sheet');
    expect(within(sheet).getByText('Приоритет')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId('create-priority-mobile-high'));
    expect(setCreateData).toHaveBeenCalled();
    expect(setCreateOptionalSections).toHaveBeenCalled();
    expect(setCreateMobileSheet).toHaveBeenCalledWith('');
  });

  it('renders description sheet with editor test ids', () => {
    renderSheet({
      sheet: 'description',
      bodyProps: baseBodyProps,
    });

    const sheet = screen.getByTestId('create-mobile-sheet');
    expect(within(sheet).getByText('Описание задачи')).toBeInTheDocument();
    expect(within(sheet).getByTestId('create-description-mobile-input')).toBeInTheDocument();
  });
});
