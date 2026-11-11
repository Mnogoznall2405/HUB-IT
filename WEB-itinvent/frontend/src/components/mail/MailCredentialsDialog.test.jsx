import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailCredentialsDialog from './MailCredentialsDialog';
import MailCredentialsGate from './MailCredentialsGate';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailCredentialsDialog', () => {
  it('saves the typed corporate password', () => {
    const onPasswordChange = vi.fn();
    const onSave = vi.fn();
    renderWithTheme(
      <MailCredentialsDialog
        open
        ui={{ radiusMd: '10px' }}
        password=""
        onPasswordChange={onPasswordChange}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('Пароль от корпоративного компьютера'), {
      target: { value: 'Secret123!' },
    });
    expect(onPasswordChange).toHaveBeenCalledWith('Secret123!');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и открыть почту' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('MailCredentialsGate', () => {
  it('opens the password dialog from the gate button', () => {
    const onEnterPassword = vi.fn();
    renderWithTheme(
      <MailCredentialsGate
        ui={{ radiusMd: '10px', borderSoft: '#ddd', panelBg: '#fff' }}
        login="user@corp"
        email="mail@corp"
        onEnterPassword={onEnterPassword}
      />,
    );

    expect(screen.getByText('Требуется корпоративный пароль')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ввести пароль' }));
    expect(onEnterPassword).toHaveBeenCalledTimes(1);
  });
});
