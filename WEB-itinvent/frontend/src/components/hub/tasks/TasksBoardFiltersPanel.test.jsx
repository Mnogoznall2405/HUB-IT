import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksBoardFiltersPanel from './TasksBoardFiltersPanel';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import { dueStateOptions, statusOptions } from '../../../pages/tasks/taskConstants';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const assigneeAutocompleteProps = {
  filterOptions: (options) => options,
  inputValue: '',
  onInputChange: vi.fn(),
};

describe('TasksBoardFiltersPanel', () => {
  it('renders search, status and reset controls', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksBoardFiltersPanel
          ui={ui}
          q=""
          onQChange={vi.fn()}
          statusFilter=""
          onStatusFilterChange={vi.fn()}
          statusOptions={statusOptions}
          dueState=""
          onDueStateChange={vi.fn()}
          dueStateOptions={dueStateOptions}
          departments={[]}
          getAssigneePickerOptions={() => []}
          controllers={[]}
          taskDiscussionChatEnabled={false}
          onResetFilters={vi.fn()}
          handleSingleAssigneeAutocompleteChange={(handler) => (_, value) => handler(value)}
          renderTaskUserOption={() => null}
          taskUserAutocompleteSlotProps={{}}
          assigneeAutocompleteProps={assigneeAutocompleteProps}
          getAssigneeAutocompleteInputValue={() => ''}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-board-filters-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Поиск по задачам')).toBeInTheDocument();
    expect(screen.getByLabelText('Статус')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сбросить фильтры' })).toBeInTheDocument();
  });

  it('calls reset handler on button click', () => {
    const onResetFilters = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksBoardFiltersPanel
          ui={ui}
          q="test"
          onQChange={vi.fn()}
          statusFilter=""
          onStatusFilterChange={vi.fn()}
          statusOptions={statusOptions}
          dueState=""
          onDueStateChange={vi.fn()}
          dueStateOptions={dueStateOptions}
          departments={[]}
          getAssigneePickerOptions={() => []}
          controllers={[]}
          taskDiscussionChatEnabled={false}
          onResetFilters={onResetFilters}
          handleSingleAssigneeAutocompleteChange={(handler) => (_, value) => handler(value)}
          renderTaskUserOption={() => null}
          taskUserAutocompleteSlotProps={{}}
          assigneeAutocompleteProps={assigneeAutocompleteProps}
          getAssigneeAutocompleteInputValue={() => ''}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });
});
