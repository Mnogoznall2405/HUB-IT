import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfirmDialogProvider, useConfirmDialog } from './ConfirmDialogProvider';

function Harness({ kind = 'confirm', options }) {
  const { confirm, prompt } = useConfirmDialog();
  const [result, setResult] = useState('pending');
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const value = kind === 'prompt' ? await prompt(options) : await confirm(options);
          setResult(JSON.stringify(value));
        }}
      >
        run
      </button>
      <output data-testid="result">{result}</output>
    </>
  );
}

const renderHarness = (props) => render(
  <ConfirmDialogProvider>
    <Harness {...props} />
  </ConfirmDialogProvider>,
);

const result = () => screen.getByTestId('result').textContent;

describe('ConfirmDialogProvider', () => {
  it('resolves true on confirm and false on cancel', async () => {
    renderHarness({ options: { title: 'Удалить сообщение?', confirmLabel: 'Удалить', destructive: true } });

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить сообщение?' });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(result()).toBe('true'));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await screen.findByRole('dialog', { name: 'Удалить сообщение?' });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(result()).toBe('false'));
  });

  it('cancels on Escape', async () => {
    renderHarness({ options: { title: 'Покинуть беседу?' } });

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Покинуть беседу?' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(result()).toBe('false'));
  });

  it('focuses the safe button for destructive actions; Enter there cancels, Enter on the dialog confirms', async () => {
    renderHarness({ options: { title: 'Исключить участника?', confirmLabel: 'Исключить', destructive: true } });

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await screen.findByRole('dialog', { name: 'Исключить участника?' });
    const cancel = screen.getByRole('button', { name: 'Отмена' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Исключить' }).className).toMatch(/containedError/);

    // Enter на сфокусированной кнопке не перехватывается — сработает сама кнопка (браузер), без подтверждения.
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(result()).toBe('pending');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    await waitFor(() => expect(result()).toBe('true'));
  });

  it('prompt returns the edited value on Enter and null on cancel', async () => {
    renderHarness({ kind: 'prompt', options: { title: 'Переименовать группу', label: 'Новое название группы', initialValue: 'Старое' } });

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    const input = await screen.findByLabelText('Новое название группы');
    expect(input).toHaveValue('Старое');
    fireEvent.change(input, { target: { value: 'Новое' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(result()).toBe('"Новое"'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    await screen.findByLabelText('Новое название группы');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(result()).toBe('null'));
  });

  it('prompt blocks submit while the value is empty or invalid', async () => {
    renderHarness({
      kind: 'prompt',
      options: {
        title: 'Новая папка',
        label: 'Название',
        validate: (value) => (value.length > 5 ? 'Не длиннее 5 символов' : ''),
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'run' }));
    const input = await screen.findByLabelText('Название');
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: 'слишком длинно' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Не длиннее 5 символов')).toBeInTheDocument();
    expect(result()).toBe('pending');

    fireEvent.change(input, { target: { value: 'ок' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(result()).toBe('"ок"'));
  });
});
