import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UploadActEmailForm, {
  formatUploadActRecipientOptionLabel,
  isSameUploadActRecipientOption,
  normalizeUploadActRecipientOption,
} from './UploadActEmailForm';

describe('UploadActEmailForm helpers', () => {
  it('normalizes recipient options from API shapes', () => {
    expect(normalizeUploadActRecipientOption({
      OWNER_NO: '42',
      OWNER_DISPLAY_NAME: 'Иванов И.И.',
      OWNER_DEPT: 'ИТ',
    })).toEqual({
      owner_no: 42,
      owner_display_name: 'Иванов И.И.',
      owner_dept: 'ИТ',
    });
  });

  it('formats recipient labels and compares options by owner number', () => {
    expect(formatUploadActRecipientOptionLabel({
      owner_display_name: 'Петров П.П.',
      owner_dept: 'АСУ',
    })).toBe('Петров П.П. (АСУ)');
    expect(formatUploadActRecipientOptionLabel({ owner_display_name: 'Сидоров С.С.' })).toBe('Сидоров С.С.');

    expect(isSameUploadActRecipientOption({ OWNER_NO: '7' }, { owner_no: 7 })).toBe(true);
    expect(isSameUploadActRecipientOption({ OWNER_NO: '7' }, { owner_no: 8 })).toBe(false);
  });
});

describe('UploadActEmailForm', () => {
  it('renders controlled fields and calls parent handlers', () => {
    const onSubjectChange = vi.fn();
    const onBodyChange = vi.fn();
    const onSend = vi.fn();

    render(
      <UploadActEmailForm
        subject="Акт №5"
        body="Во вложении акт."
        recipientOptions={[]}
        recipients={[]}
        recipientsInput=""
        onSubjectChange={onSubjectChange}
        onBodyChange={onBodyChange}
        onRecipientsInputChange={vi.fn()}
        onRecipientsChange={vi.fn()}
        onSend={onSend}
        summarySlot={<span>summary slot</span>}
      />
    );

    expect(screen.getByText('4. Отправка акта по email')).toBeInTheDocument();
    expect(screen.getByText('summary slot')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Тема письма'), { target: { value: 'Новая тема' } });
    fireEvent.change(screen.getByLabelText('Текст письма'), { target: { value: 'Новый текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить выбранным' }));

    expect(onSubjectChange).toHaveBeenCalledWith('Новая тема');
    expect(onBodyChange).toHaveBeenCalledWith('Новый текст');
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('disables send button while email is sending', () => {
    render(
      <UploadActEmailForm
        subject=""
        body=""
        recipientOptions={[]}
        recipients={[]}
        recipientsInput=""
        emailLoading
      />
    );

    expect(screen.getByRole('button', { name: /Отправка/ })).toBeDisabled();
  });
});
