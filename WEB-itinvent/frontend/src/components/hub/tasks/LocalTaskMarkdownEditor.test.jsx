import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import LocalTaskMarkdownEditor from './LocalTaskMarkdownEditor';

vi.mock('../MarkdownEditor', () => ({
  default: ({ value, onChange, ...props }) => (
    <textarea
      data-testid="markdown-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      {...props}
    />
  ),
}));

const theme = createTheme();

describe('LocalTaskMarkdownEditor', () => {
  it('renders markdown editor with initial value', () => {
    render(
      <ThemeProvider theme={theme}>
        <LocalTaskMarkdownEditor initialValue="Описание" onDraftChange={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('markdown-editor')).toHaveValue('Описание');
  });
});
