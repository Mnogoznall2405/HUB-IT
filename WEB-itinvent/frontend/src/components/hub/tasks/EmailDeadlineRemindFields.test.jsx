import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import EmailDeadlineRemindFields from './EmailDeadlineRemindFields';

const theme = createTheme();

const renderField = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <EmailDeadlineRemindFields
      dueAt="2026-06-13T12:00:00"
      mode="default"
      hours={24}
      onModeChange={() => {}}
      onHoursChange={() => {}}
      {...props}
    />
  </ThemeProvider>,
);

describe('EmailDeadlineRemindFields', () => {
  it('renders nothing without due date', () => {
    const { container } = renderField({ dueAt: '' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders reminder modes when due date is set', () => {
    renderField({ testIdPrefix: 'email-remind-test' });
    expect(screen.getByTestId('email-remind-test-block')).toBeInTheDocument();
    expect(screen.getByTestId('email-remind-test-mode-default')).toBeInTheDocument();
    expect(screen.getByTestId('email-remind-test-mode-off')).toBeInTheDocument();
  });

  it('shows hours select in custom mode', () => {
    renderField({ mode: 'custom', testIdPrefix: 'email-remind-test' });
    expect(screen.getByTestId('email-remind-test-hours')).toBeInTheDocument();
  });
});
