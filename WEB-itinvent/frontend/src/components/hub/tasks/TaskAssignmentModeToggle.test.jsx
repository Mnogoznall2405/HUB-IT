import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TaskAssignmentModeToggle from './TaskAssignmentModeToggle';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

function ControlledToggle({ assigneeCount, onChange }) {
  const [value, setValue] = useState('shared');
  return (
    <ThemeProvider theme={theme}>
      <TaskAssignmentModeToggle
        value={value}
        assigneeCount={assigneeCount}
        ui={ui}
        testIdPrefix="mode"
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </ThemeProvider>
  );
}

describe('TaskAssignmentModeToggle', () => {
  it('stays hidden until there are at least two assignees', () => {
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <TaskAssignmentModeToggle value="shared" assigneeCount={0} ui={ui} testIdPrefix="mode" onChange={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('group', { name: 'Режим назначения исполнителей' })).not.toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <TaskAssignmentModeToggle value="shared" assigneeCount={1} ui={ui} testIdPrefix="mode" onChange={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('group', { name: 'Режим назначения исполнителей' })).not.toBeInTheDocument();
  });

  it('switches to a separate task per assignee and explains the consequence', () => {
    const onChange = vi.fn();
    render(<ControlledToggle assigneeCount={3} onChange={onChange} />);

    expect(screen.getByText('Все исполнители работают над одной задачей')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отдельная задача каждому' }));

    expect(onChange).toHaveBeenCalledWith('separate');
    expect(screen.getByText('Каждый получит свою задачу: 3 задач, статусы независимы')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отдельная задача каждому' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('cannot be cleared: re-clicking the selected option keeps the current mode', () => {
    const onChange = vi.fn();
    render(<ControlledToggle assigneeCount={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Одна задача на всех' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Одна задача на всех' })).toHaveAttribute('aria-pressed', 'true');
  });
});
