import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import {
  createTaskUserAutocompleteOptionRenderer,
  createTaskUserAutocompleteTagsRenderer,
} from './taskUserAutocompleteRenderers';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const user = {
  id: '1',
  full_name: 'Иванов Иван',
  username: 'ivanov',
};

describe('taskUserAutocompleteRenderers', () => {
  it('renders option with user label', () => {
    const renderOption = createTaskUserAutocompleteOptionRenderer({ ui, theme, multiple: false });
    render(
      <ThemeProvider theme={theme}>
        <ul>{renderOption({ key: 'opt-1' }, user, { selected: false })}</ul>
      </ThemeProvider>,
    );

    expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
    expect(screen.getByText('@ivanov')).toBeInTheDocument();
  });

  it('renders tags with user label', () => {
    const renderTags = createTaskUserAutocompleteTagsRenderer({ theme });
    render(
      <ThemeProvider theme={theme}>
        <div>{renderTags([user], (props) => ({ ...props, key: 'tag-1' }))}</div>
      </ThemeProvider>,
    );

    expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
  });
});
