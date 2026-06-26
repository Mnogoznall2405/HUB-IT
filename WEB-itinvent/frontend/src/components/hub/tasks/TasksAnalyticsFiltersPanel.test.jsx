import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksAnalyticsFiltersPanel from './TasksAnalyticsFiltersPanel';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import { buildAnalyticsRangeFromPreset } from '../../../pages/tasks/taskAnalyticsModel';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const baseFilters = {
  preset: '30d',
  ...buildAnalyticsRangeFromPreset('30d'),
  date_basis: 'protocol_date',
  project_ids: [],
  object_ids: [],
  participant_user_id: '',
};

const focusMeta = {
  title: 'Все проекты',
  description: 'Сводка',
  chips: [],
};

describe('TasksAnalyticsFiltersPanel', () => {
  it('renders period and slice controls', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksAnalyticsFiltersPanel
          ui={ui}
          analyticsFilters={baseFilters}
          onFiltersChange={vi.fn()}
          analyticsFilterFieldSx={{}}
          activeTaskProjects={[{ id: 'project-1', name: 'Проект Север' }]}
          analyticsObjectOptions={[]}
          activeTaskObjects={[]}
          analyticsFocusMeta={focusMeta}
          getAssigneePickerOptions={() => []}
          handleSingleAssigneeAutocompleteChange={(handler) => (_, value) => handler(value)}
          renderTaskUserOption={() => null}
          taskUserAutocompleteSlotProps={{}}
          assigneeAutocompleteProps={{
            filterOptions: (options) => options,
            inputValue: '',
            onInputChange: vi.fn(),
          }}
          getAssigneeAutocompleteInputValue={() => ''}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('Период')).toBeInTheDocument();
    expect(screen.getByLabelText('Проекты')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сбросить срез' })).toBeInTheDocument();
  });

  it('resets slice filters on button click', () => {
    const onFiltersChange = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksAnalyticsFiltersPanel
          ui={ui}
          analyticsFilters={{ ...baseFilters, project_ids: ['project-1'], participant_user_id: '5' }}
          onFiltersChange={onFiltersChange}
          analyticsFilterFieldSx={{}}
          activeTaskProjects={[{ id: 'project-1', name: 'Проект Север' }]}
          analyticsObjectOptions={[]}
          activeTaskObjects={[]}
          analyticsFocusMeta={focusMeta}
          getAssigneePickerOptions={() => []}
          handleSingleAssigneeAutocompleteChange={(handler) => (_, value) => handler(value)}
          renderTaskUserOption={() => null}
          taskUserAutocompleteSlotProps={{}}
          assigneeAutocompleteProps={{
            filterOptions: (options) => options,
            inputValue: '',
            onInputChange: vi.fn(),
          }}
          getAssigneeAutocompleteInputValue={() => ''}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить срез' }));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({
      project_ids: [],
      object_ids: [],
      participant_user_id: '',
    }));
  });
});
