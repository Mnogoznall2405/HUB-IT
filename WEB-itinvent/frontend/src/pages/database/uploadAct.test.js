import { describe, expect, it } from 'vitest';

import {
  buildUploadActCommitPayload,
  buildUploadActDraftFormState,
  buildUploadActEmailDefaults,
  buildUploadActEmailResultState,
  buildUploadActSelectedEmailPayload,
  createEmptyUploadActEmailSummary,
  getUploadActAutoEmailEmployees,
  getUploadActEmailErrorMessage,
} from './uploadAct';

describe('uploadAct form and payload helpers', () => {
  it('builds form state from a recognized draft', () => {
    expect(buildUploadActDraftFormState({
      from_employee: '  Иванов И.И. ',
      to_employee: ' Петров П.П.  ',
      doc_date: ' 2026-05-02 ',
      equipment_inv_nos: [100887, '100888'],
    })).toEqual({
      from_employee: 'Иванов И.И.',
      to_employee: 'Петров П.П.',
      doc_date: '2026-05-02',
      equipment_inv_nos_text: '100887, 100888',
    });

    expect(buildUploadActDraftFormState({ equipment_inv_nos: '100887' })).toEqual({
      from_employee: '',
      to_employee: '',
      doc_date: '',
      equipment_inv_nos_text: '',
    });
  });

  it('validates commit payload draft and inventory requirements', () => {
    expect(buildUploadActCommitPayload({
      draft: { draft_id: '   ' },
      form: { equipment_inv_nos_text: '100887' },
    })).toEqual({
      error: 'Черновик не найден. Выполните распознавание снова.',
      payload: null,
    });

    expect(buildUploadActCommitPayload({
      draft: { draft_id: ' draft-1 ' },
      form: { equipment_inv_nos_text: 'abc ; /' },
    })).toEqual({
      error: 'Укажите хотя бы один инвентарный номер для привязки акта.',
      payload: null,
    });
  });

  it('builds commit payload with trimmed optional fields', () => {
    expect(buildUploadActCommitPayload({
      draft: { draft_id: ' draft-1 ' },
      form: {
        from_employee: ' Иванов ',
        to_employee: '',
        doc_date: ' 2026-05-02 ',
        equipment_inv_nos_text: '№101795, 101796.0, abc, 101795',
      },
      reminderBinding: {
        task_id: ' task-9 ',
        reminder_id: ' reminder-3 ',
      },
    })).toEqual({
      error: '',
      payload: {
        draft_id: 'draft-1',
        from_employee: 'Иванов',
        to_employee: undefined,
        doc_date: '2026-05-02',
        equipment_inv_nos: ['101795', '101796'],
        source_task_id: 'task-9',
        reminder_id: 'reminder-3',
      },
    });
  });

  it('trims auto email employees from form fields', () => {
    expect(getUploadActAutoEmailEmployees({
      from_employee: '  Иванов ',
      to_employee: ' Петров  ',
    })).toEqual({
      fromEmployee: 'Иванов',
      toEmployee: 'Петров',
    });
  });

  it('keeps selected email silent when commit result has no doc number', () => {
    expect(buildUploadActSelectedEmailPayload({
      commitResult: {},
      recipients: [{ OWNER_NO: 10 }],
      subject: 'Subject',
      body: 'Body',
    })).toEqual({
      error: '',
      payload: null,
    });
  });

  it('validates selected email recipients', () => {
    expect(buildUploadActSelectedEmailPayload({
      commitResult: { doc_no: 55 },
      recipients: [{ OWNER_NO: null }, { owner_no: 'bad' }],
    })).toEqual({
      error: 'Выберите хотя бы одного сотрудника.',
      payload: null,
    });
  });

  it('builds selected email payload and filters invalid owner numbers', () => {
    expect(buildUploadActSelectedEmailPayload({
      commitResult: { doc_no: '55' },
      recipients: [
        { OWNER_NO: '10' },
        { owner_no: 20 },
        { OWNER_NO: null },
        { owner_no: 'bad' },
      ],
      subject: '  Тема ',
      body: '  Текст письма ',
    })).toEqual({
      error: '',
      payload: {
        doc_no: 55,
        mode: 'selected',
        owner_nos: [10, 20],
        subject: 'Тема',
        body: 'Текст письма',
      },
    });
  });
});

describe('uploadAct email helpers', () => {
  it('builds stable default email subject and body from doc number', () => {
    expect(buildUploadActEmailDefaults(123)).toEqual({
      subject: 'Акт №123',
      body: 'Во вложении акт №123.\n\nПисьмо сформировано автоматически системой IT Invent.',
    });

    expect(buildUploadActEmailDefaults('')).toEqual({
      subject: 'Акт №',
      body: 'Во вложении акт №.\n\nПисьмо сформировано автоматически системой IT Invent.',
    });
  });

  it('normalizes empty email summary state', () => {
    expect(createEmptyUploadActEmailSummary()).toEqual({
      mode: '',
      successCount: 0,
      failedCount: 0,
    });
  });

  it('maps auto email results into recipients, summary, status and optional warning', () => {
    const recipients = [{ employee_name: 'User One', status: 'sent' }];

    expect(buildUploadActEmailResultState({
      success_count: 1,
      failed_count: 0,
      recipients,
    }, { mode: 'auto' })).toEqual({
      recipients,
      summary: {
        mode: 'auto',
        successCount: 1,
        failedCount: 0,
      },
      status: 'Автоотправка: отправлено 1, ошибок 0.',
      error: '',
    });

    expect(buildUploadActEmailResultState({
      success_count: 1,
      failed_count: 2,
      recipients: 'bad-shape',
    }, { mode: 'auto' })).toEqual({
      recipients: [],
      summary: {
        mode: 'auto',
        successCount: 1,
        failedCount: 2,
      },
      status: 'Автоотправка: отправлено 1, ошибок 2.',
      error: 'Часть писем не отправлена. Проверьте статусы ниже.',
    });
  });

  it('maps selected recipient email results with manual-send copy', () => {
    expect(buildUploadActEmailResultState({
      success_count: 3,
      failed_count: 1,
      recipients: [],
    }, { mode: 'selected' })).toEqual({
      recipients: [],
      summary: {
        mode: 'selected',
        successCount: 3,
        failedCount: 1,
      },
      status: 'Отправлено: 3, ошибок: 1.',
      error: 'Часть писем не отправлена. Проверьте список статусов.',
    });
  });

  it('prefers backend detail for email errors and falls back to local text', () => {
    expect(getUploadActEmailErrorMessage({
      response: {
        data: {
          detail: 'Mailbox unavailable',
        },
      },
    }, 'Fallback')).toBe('Mailbox unavailable');

    expect(getUploadActEmailErrorMessage({}, 'Fallback')).toBe('Fallback');
  });
});
