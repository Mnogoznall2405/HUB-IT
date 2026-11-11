import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TaskRoleScopeSwitch from './TaskRoleScopeSwitch';

describe('TaskRoleScopeSwitch', () => {
  it('renders assignee and creator options with counts', () => {
    const onChange = vi.fn();
    render(
      <TaskRoleScopeSwitch
        value="assignee"
        onChange={onChange}
        counts={{ assignee: 4, creator: 2 }}
      />,
    );

    expect(screen.getByTestId('tasks-role-scope-switch')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-role-assignee')).toHaveTextContent('Исполняю (4)');
    expect(screen.getByTestId('tasks-role-creator')).toHaveTextContent('Созданные (2)');
  });

  it('calls onChange when creator is selected', () => {
    const onChange = vi.fn();
    render(<TaskRoleScopeSwitch value="assignee" onChange={onChange} />);

    fireEvent.click(screen.getByTestId('tasks-role-creator'));
    expect(onChange).toHaveBeenCalledWith('creator');
  });

  it('keeps toggle unselected for secondary view modes', () => {
    render(<TaskRoleScopeSwitch value="all" onChange={vi.fn()} />);

    expect(screen.getByTestId('tasks-role-assignee')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('tasks-role-creator')).toHaveAttribute('aria-pressed', 'false');
  });
});
