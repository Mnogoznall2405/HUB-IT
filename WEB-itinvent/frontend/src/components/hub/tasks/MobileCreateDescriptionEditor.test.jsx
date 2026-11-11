import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import MobileCreateDescriptionEditor from './MobileCreateDescriptionEditor';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('MobileCreateDescriptionEditor', () => {
  it('renders mobile description editor', () => {
    render(
      <ThemeProvider theme={theme}>
        <MobileCreateDescriptionEditor
          initialValue="Описание задачи"
          onDraftChange={() => {}}
          onDone={() => {}}
          ui={ui}
          theme={theme}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('create-description-mobile-input')).toBeInTheDocument();
  });
});
