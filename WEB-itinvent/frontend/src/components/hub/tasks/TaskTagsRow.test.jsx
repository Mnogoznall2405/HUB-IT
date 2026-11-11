import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

import TaskTagsRow from './TaskTagsRow';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('TaskTagsRow', () => {
  it('renders status and overdue chips for a task', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskTagsRow
          task={{
            id: 'task-1',
            status: 'in_progress',
            is_overdue: true,
            has_unread_comments: true,
          }}
          ui={ui}
          alpha={alpha}
          taskDiscussionChatEnabled={false}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('В работе')).toBeInTheDocument();
    expect(screen.getByText('Просрочено')).toBeInTheDocument();
  });
});
