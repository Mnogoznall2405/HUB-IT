import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TaskUserPickerRow from './TaskUserPickerRow';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('TaskUserPickerRow', () => {
  it('renders user label and username', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskUserPickerRow
          userItem={{ id: '1', full_name: 'Иванов Иван', username: 'ivanov' }}
          ui={ui}
          theme={theme}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
    expect(screen.getByText('@ivanov')).toBeInTheDocument();
  });
});
