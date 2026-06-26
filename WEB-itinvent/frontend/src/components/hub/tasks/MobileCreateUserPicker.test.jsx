import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import MobileCreateUserPicker from './MobileCreateUserPicker';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('MobileCreateUserPicker', () => {
  it('renders search field and options', () => {
    render(
      <ThemeProvider theme={theme}>
        <MobileCreateUserPicker
          options={[{ id: '1', full_name: 'Иванов Иван', username: 'ivanov' }]}
          selectedIds={[]}
          onChange={vi.fn()}
          onDone={vi.fn()}
          ui={ui}
          theme={theme}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('Поиск пользователей')).toBeInTheDocument();
    expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
  });
});
