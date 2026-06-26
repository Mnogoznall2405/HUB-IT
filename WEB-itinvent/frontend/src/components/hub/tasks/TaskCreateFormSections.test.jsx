import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { TaskDueFields } from './TaskCreateFormSections';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('TaskCreateFormSections', () => {
  it('renders due fields block', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskDueFields
          dueLabel="Завтра"
          dueAt="2026-06-27T12:00"
          onOpenDuePicker={() => {}}
          emailRemindMode="default"
          emailRemindHours={24}
          onEmailRemindModeChange={() => {}}
          onEmailRemindHoursChange={() => {}}
          ui={ui}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('Завтра')).toBeInTheDocument();
  });
});
