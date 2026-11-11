import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksTaxonomyDialog from './TasksTaxonomyDialog';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import { createEmptyObjectDraft, createEmptyProjectDraft } from '../../../pages/tasks/taskCreateModel';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const projects = [{ id: 'project-1', name: 'Проект Север', code: 'N', is_active: true }];
const objects = [{ id: 'object-1', name: 'Склад', project_id: 'project-1', is_active: true }];

describe('TasksTaxonomyDialog', () => {
  it('renders project and object sections', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksTaxonomyDialog
          open
          onClose={vi.fn()}
          ui={ui}
          projectDraft={createEmptyProjectDraft()}
          setProjectDraft={vi.fn()}
          objectDraft={createEmptyObjectDraft('project-1')}
          setObjectDraft={vi.fn()}
          taskProjects={projects}
          taskObjects={objects}
          activeTaskProjects={projects}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Проекты и объекты')).toBeInTheDocument();
    expect(screen.getAllByText('Проект Север').length).toBeGreaterThan(0);
    expect(screen.getByText('Склад')).toBeInTheDocument();
    expect(screen.getByText(/Объектов: 1/)).toBeInTheDocument();
  });

  it('calls onSaveProject when add button clicked', () => {
    const onSaveProject = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksTaxonomyDialog
          open
          onClose={vi.fn()}
          ui={ui}
          projectDraft={{ ...createEmptyProjectDraft(), name: 'Новый проект' }}
          setProjectDraft={vi.fn()}
          objectDraft={createEmptyObjectDraft()}
          setObjectDraft={vi.fn()}
          onSaveProject={onSaveProject}
          taskProjects={[]}
          taskObjects={[]}
          activeTaskProjects={[]}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Добавить проект' }));
    expect(onSaveProject).toHaveBeenCalledTimes(1);
  });
});
