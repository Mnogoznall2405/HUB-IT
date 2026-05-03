import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UploadActDialog from './UploadActDialog';

const ui = {
  panelSolid: '#fff',
  panelBg: '#f8fafc',
  borderSoft: '#d8dee9',
  shellShadow: 'none',
};

const form = {
  document_title: '',
  from_employee: '',
  to_employee: '',
  doc_date: '',
  equipment_inv_nos_text: '',
};

const invVerification = {
  recognizedInvNos: ['1001'],
  finalInvNos: ['1001'],
  onlyRecognizedInvNos: [],
  onlyFinalInvNos: [],
  severity: 'info',
  headline: 'Все номера совпадают.',
};

describe('UploadActDialog', () => {
  it('renders parse step and delegates close and commit actions', () => {
    const onClose = vi.fn();
    const onCommit = vi.fn();

    render(
      <UploadActDialog
        open
        ui={ui}
        form={form}
        invVerification={invVerification}
        onClose={onClose}
        onCommit={onCommit}
        commitDisabled={false}
      />
    );

    expect(screen.getByText('Загрузка подписанного акта')).toBeInTheDocument();
    expect(screen.getByText('1. Выбор и распознавание PDF')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и записать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders draft verification and forwards controlled field changes', () => {
    const onFieldChange = vi.fn();
    const onInvNosChange = vi.fn();
    const onInvVerifiedChange = vi.fn();

    render(
      <UploadActDialog
        open
        ui={ui}
        form={form}
        invVerification={invVerification}
        draft={{
          warnings: ['Проверьте дату'],
          resolved_items: [{ inv_no: '1001', model_name: 'Notebook' }],
        }}
        onFieldChange={onFieldChange}
        onInvNosChange={onInvNosChange}
        onInvVerifiedChange={onInvVerifiedChange}
      />
    );

    expect(screen.getByText('2. Проверка данных акта')).toBeInTheDocument();
    expect(screen.getByText('Проверьте дату')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Название документа'), {
      target: { value: 'Акт передачи' },
    });
    fireEvent.change(screen.getByLabelText('Инв. № (через запятую)'), {
      target: { value: '1001,1002' },
    });
    fireEvent.click(screen.getByLabelText('Я проверил инвентарные номера по PDF перед записью акта'));

    expect(onFieldChange).toHaveBeenCalledWith('document_title', 'Акт передачи');
    expect(onInvNosChange).toHaveBeenCalledTimes(1);
    expect(onInvVerifiedChange).toHaveBeenCalledWith(true);
  });

  it('renders commit result email step and delegates close and send actions', () => {
    const onClose = vi.fn();
    const onEmailSend = vi.fn();
    const onEmailRecipientsChange = vi.fn();
    const onEmailErrorClear = vi.fn();

    render(
      <UploadActDialog
        open
        ui={ui}
        form={form}
        invVerification={invVerification}
        commitResult={{ doc_no: 12, file_no: 34 }}
        emailSubject="Акт №12"
        emailBody="Во вложении акт."
        emailRecipientOptions={[
          { owner_no: 7, owner_display_name: 'Иванов И.И.', owner_dept: 'ИТ' },
        ]}
        emailRecipients={[]}
        emailRecipientsInput=""
        emailStatus="Отправлено"
        emailError="Один получатель без email"
        emailLastRecipients={[
          { owner_no: 7, employee_name: 'Иванов И.И.', email: 'ivanov@example.test', status: 'sent' },
        ]}
        onClose={onClose}
        onEmailSend={onEmailSend}
        onEmailRecipientsChange={onEmailRecipientsChange}
        onEmailErrorClear={onEmailErrorClear}
      />
    );

    expect(screen.getByText(/DOC_NO 12/)).toBeInTheDocument();
    expect(screen.getAllByText('Отправлено')).toHaveLength(2);
    expect(screen.getByText('Один получатель без email')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить выбранным' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    expect(onEmailSend).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEmailRecipientsChange).not.toHaveBeenCalled();
    expect(onEmailErrorClear).not.toHaveBeenCalled();
  });
});
