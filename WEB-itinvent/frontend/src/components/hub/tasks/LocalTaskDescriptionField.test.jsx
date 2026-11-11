import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import LocalTaskDescriptionField from './LocalTaskDescriptionField';

const theme = createTheme();

describe('LocalTaskDescriptionField', () => {
  it('renders description field and syncs draft changes', () => {
    const onDraftChange = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <LocalTaskDescriptionField
          label="Описание"
          initialValue="Текст"
          onDraftChange={onDraftChange}
        />
      </ThemeProvider>,
    );
    const input = screen.getByLabelText('Описание');
    expect(input).toHaveValue('Текст');
    fireEvent.change(input, { target: { value: 'Новый текст' } });
    expect(onDraftChange).toHaveBeenCalled();
  });
});
