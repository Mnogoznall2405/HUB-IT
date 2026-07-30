import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Docflow from './Docflow';
import { docflowAPI } from '../api/docflow';


const { useMediaQueryMock } = vi.hoisted(() => ({
  useMediaQueryMock: vi.fn(),
}));

vi.mock('@mui/material/useMediaQuery', () => ({
  default: useMediaQueryMock,
}));

vi.mock('../api/docflow', () => ({
  docflowAPI: {
    getProfile: vi.fn(),
    testCredentials: vi.fn(),
    saveCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
    listTasks: vi.fn(),
    getTask: vi.fn(),
    applyTaskAction: vi.fn(),
    getCommand: vi.fn(),
    getAssignmentCapability: vi.fn(),
    searchAssignmentDocuments: vi.fn(),
    searchAssignmentAssignees: vi.fn(),
    createAssignment: vi.fn(),
    getAssignmentCommand: vi.fn(),
    downloadFile: vi.fn(),
    downloadFilePreviewPdf: vi.fn(),
  },
}));

vi.mock('../components/mail/MailAttachmentPreviewDialog', () => ({
  default: ({ attachmentPreview }) => (
    attachmentPreview?.open
      ? <div data-testid="docflow-file-preview">{attachmentPreview.loading ? 'Загрузка файла' : attachmentPreview.filename}</div>
      : null
  ),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../components/layout/MobileShellPageHeader', () => ({
  default: () => null,
}));


describe('Docflow page', () => {
  beforeEach(() => {
    useMediaQueryMock.mockReset();
    useMediaQueryMock.mockReturnValue(false);
    docflowAPI.getProfile.mockReset();
    docflowAPI.testCredentials.mockReset();
    docflowAPI.saveCredentials.mockReset();
    docflowAPI.deleteCredentials.mockReset();
    docflowAPI.listTasks.mockReset();
    docflowAPI.getTask.mockReset();
    docflowAPI.applyTaskAction.mockReset();
    docflowAPI.getCommand.mockReset();
    docflowAPI.getAssignmentCapability.mockReset();
    docflowAPI.searchAssignmentDocuments.mockReset();
    docflowAPI.searchAssignmentAssignees.mockReset();
    docflowAPI.createAssignment.mockReset();
    docflowAPI.getAssignmentCommand.mockReset();
    docflowAPI.downloadFile.mockReset();
    docflowAPI.downloadFilePreviewPdf.mockReset();
    docflowAPI.listTasks.mockResolvedValue({
      items: [],
      returned: 0,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    docflowAPI.getAssignmentCapability.mockResolvedValue({ enabled: false, reason: 'Пилот выключен.' });
    docflowAPI.searchAssignmentDocuments.mockResolvedValue({ items: [], returned: 0, truncated: false });
    docflowAPI.searchAssignmentAssignees.mockResolvedValue({ items: [], returned: 0, truncated: false });
    docflowAPI.getTask.mockResolvedValue({
      ref: '00000000-0000-0000-0000-000000000001',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задача исполнителя',
      title: 'Задание 1С',
      completed: false,
      files: [],
    });
  });

  it('does not request tasks before personal credentials are configured', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: false,
      login: null,
      status: 'not_configured',
    });

    render(<Docflow />);

    expect(await screen.findByText(/Введите личные данные 1С/)).toBeInTheDocument();
    expect(docflowAPI.listTasks).not.toHaveBeenCalled();
  });

  it('loads only the current users live 1C tasks after profile resolution', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [
        {
          ref: 'task-ref-1',
          task_type: 'ЗадачаИсполнителя',
          task_type_label: 'Задача исполнителя',
          title: 'Согласовать служебную записку',
          author: 'Иванов И.И.',
          description: 'Проверьте сумму и основание платежа.',
          completed: false,
        },
      ],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    docflowAPI.getTask.mockResolvedValue({
      ref: 'task-ref-1',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задача исполнителя',
      title: 'Согласовать служебную записку',
      author: 'Иванов И.И.',
      description: 'Проверьте сумму и основание платежа.',
      completed: false,
      files: [],
    });

    render(<Docflow />);

    expect(await screen.findByText('Согласовать служебную записку')).toBeInTheDocument();
    expect(screen.getByText('Подключено как personal.login')).toBeInTheDocument();
    expect(docflowAPI.listTasks).toHaveBeenCalledTimes(1);
    expect(docflowAPI.listTasks).toHaveBeenCalledWith({ scope: 'inbox', q: '', limit: 50 });

    fireEvent.click(screen.getByText('Согласовать служебную записку').closest('[role="button"]'));
    expect(await screen.findByText('Проверьте сумму и основание платежа.')).toBeInTheDocument();
    expect(docflowAPI.getTask).toHaveBeenCalledTimes(1);
  });

  it('creates a pilot assignment with one idempotent request', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.getAssignmentCapability.mockResolvedValue({ enabled: true, reason: null });
    docflowAPI.searchAssignmentDocuments.mockResolvedValue({
      items: [{
        ref: '33333333-3333-3333-3333-333333333333',
        document_type: 'internal',
        document_type_label: 'Внутренний документ',
        title: 'HUB-IT TEST документ',
        number: '1',
      }],
      returned: 1,
      truncated: false,
    });
    docflowAPI.searchAssignmentAssignees.mockResolvedValue({
      items: [{
        ref: '44444444-4444-4444-4444-444444444444',
        name: 'Тестовый исполнитель',
        department: 'ИТ',
      }],
      returned: 1,
      truncated: false,
    });
    docflowAPI.createAssignment.mockResolvedValue({
      command_id: 'command-1',
      status: 'applied',
      assignment: {
        process_ref: '55555555-5555-5555-5555-555555555555',
        title: 'HUB-IT TEST · Поручение',
      },
    });

    render(<Docflow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Создать поручение' }));
    await waitFor(() => expect(docflowAPI.searchAssignmentDocuments).toHaveBeenCalledTimes(1));
    const documentInput = screen.getByLabelText('Документ 1С *');
    fireEvent.mouseDown(documentInput);
    fireEvent.click(await screen.findByText('HUB-IT TEST документ'));
    const assigneeInput = screen.getByLabelText('Исполнитель *');
    fireEvent.mouseDown(assigneeInput);
    fireEvent.click(await screen.findByText('Тестовый исполнитель'));
    fireEvent.change(screen.getByLabelText('Название поручения *'), {
      target: { value: 'HUB-IT TEST · Поручение' },
    });
    fireEvent.change(screen.getByLabelText('Описание поручения *'), {
      target: { value: 'Тестовое описание' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать в 1С' }));

    await waitFor(() => expect(docflowAPI.createAssignment).toHaveBeenCalledTimes(1));
    expect(docflowAPI.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        document_type: 'internal',
        document_ref: '33333333-3333-3333-3333-333333333333',
        assignee_ref: '44444444-4444-4444-4444-444444444444',
        title: 'HUB-IT TEST · Поручение',
        description: 'Тестовое описание',
      }),
      expect.any(String),
    );
  });

  it('removes the HUB-IT TEST prefix when real assignment rollout is enabled', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.getAssignmentCapability.mockResolvedValue({
      enabled: true,
      reason: null,
      test_only: false,
      required_title_prefix: null,
    });
    docflowAPI.searchAssignmentDocuments.mockResolvedValue({ items: [], returned: 0, truncated: false });
    docflowAPI.searchAssignmentAssignees.mockResolvedValue({ items: [], returned: 0, truncated: false });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать поручение' }));

    expect(await screen.findByLabelText('Название поручения *')).toHaveValue('');
    expect(screen.getByText('Укажите понятное название поручения для исполнителя.')).toBeInTheDocument();
  });

  it('loads full detail once on open, caches it, and opens an attached Office file in the shared preview', async () => {
    const taskRef = '11111111-1111-1111-1111-111111111111';
    const fileRef = '22222222-2222-2222-2222-222222222222';
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{
        ref: taskRef,
        title: 'Согласовать договор',
        number: 'ГЛ-000000000000000000000000000000000001',
        due_at: '2026-08-01T12:00:00',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: false,
      }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    docflowAPI.getTask.mockResolvedValue({
      ref: taskRef,
      title: 'Согласовать договор',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задача исполнителя',
      number: 'ГЛ-000000000000000000000000000000000001',
      description: 'Полный текст задания из 1С.',
      created_at: '2026-07-28T10:00:00',
      due_at: '2026-08-01T12:00:00',
      completed: false,
      related_objects: [{
        ref: '33333333-3333-3333-3333-333333333333',
        title: 'Служебная записка на согласование',
        object_type: 'DMIncomingDocument',
      }],
      files: [{
        ref: fileRef,
        name: 'Договор.docx',
        xdto_type: 'DMFile',
        content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 2048,
        preview_supported: true,
      }, {
        ref: '44444444-4444-4444-4444-444444444444',
        name: 'ГЛ-000000000000000000000000000000000001',
        xdto_type: 'DMFileVersion',
        size: 0,
        preview_supported: false,
      }],
    });
    docflowAPI.downloadFilePreviewPdf.mockResolvedValue({
      data: new Blob(['%PDF-preview'], { type: 'application/pdf' }),
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="preview.pdf"',
        'x-docflow-preview-source-kind': 'word',
      },
    });

    render(<Docflow />);
    expect(await screen.findByText(/Срок исполнения: 01 авг. 2026/)).toBeInTheDocument();
    expect(screen.queryByText('ГЛ-000000000000000000000000000000000001')).not.toBeInTheDocument();
    fireEvent.click((await screen.findByText('Согласовать договор')).closest('[role="button"]'));

    expect(await screen.findByText('Полный текст задания из 1С.')).toBeInTheDocument();
    expect(screen.getByText('Договор.docx')).toBeInTheDocument();
    expect(screen.queryByText('ГЛ-000000000000000000000000000000000001')).not.toBeInTheDocument();
    expect(screen.getByText('Служебная записка на согласование')).toBeInTheDocument();
    expect(screen.queryByText('DMIncomingDocument')).not.toBeInTheDocument();
    expect(screen.queryByText('Номер')).not.toBeInTheDocument();
    expect(docflowAPI.getTask).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^Договор\.docx/ }));
    expect(await screen.findByTestId('docflow-file-preview')).toHaveTextContent('Договор.docx');
    expect(docflowAPI.downloadFilePreviewPdf).toHaveBeenCalledWith(taskRef, fileRef);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть карточку задания' }));
    fireEvent.click(screen.getByText('Согласовать договор').closest('[role="button"]'));
    await screen.findByText('Полный текст задания из 1С.');
    expect(docflowAPI.getTask).toHaveBeenCalledTimes(1);
  });

  it('uses compact full-width controls and a bottom task surface on mobile', async () => {
    useMediaQueryMock.mockReturnValue(true);
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{
        ref: 'mobile-task-1',
        title: 'Согласовать договор',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: false,
      }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });

    render(<Docflow />);

    expect(await screen.findByRole('button', { name: 'В работе', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Готово' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Согласовать договор').closest('[role="button"]'));
    expect(await screen.findByRole('button', { name: 'Закрыть карточку задания' })).toBeInTheDocument();
  });

  it('sends a password only from the dialog and clears it after save', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: false,
      login: null,
      status: 'not_configured',
    });
    docflowAPI.saveCredentials.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить 1С' }));

    fireEvent.change(await screen.findByLabelText(/Логин 1С/), { target: { value: 'personal.login' } });
    fireEvent.change(await screen.findByLabelText(/Пароль 1С/), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить и сохранить' }));

    await waitFor(() => expect(docflowAPI.saveCredentials).toHaveBeenCalledWith({
      login: 'personal.login',
      password: 'temporary-password',
    }));
    await waitFor(() => expect(screen.queryByLabelText(/Пароль 1С/)).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('temporary-password')).not.toBeInTheDocument();
  });

  it('clears an unsaved password when the credentials dialog closes', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: false,
      login: null,
      status: 'not_configured',
    });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить 1С' }));
    fireEvent.change(await screen.findByLabelText(/Пароль 1С/), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить 1С' }));

    expect(screen.getByLabelText(/Пароль 1С/)).toHaveValue('');
  });

  it('shows a touch-friendly credentials form on mobile', async () => {
    useMediaQueryMock.mockReturnValue(true);
    docflowAPI.getProfile.mockResolvedValue({
      configured: false,
      login: null,
      status: 'not_configured',
    });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить 1С' }));

    expect(screen.getByRole('heading', { name: 'Подключение к 1С' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать пароль' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить и сохранить' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Проверить подключение' })).toBeEnabled();
  });

  it('shows a sanitized mapping error with correlation id and an explicit retry', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockRejectedValue({
      response: {
        data: {
          detail: {
            code: 'DOCFLOW_MAPPING_REQUIRED',
            message: 'Метаданные заданий 1С требуют настройки',
            correlation_id: 'corr-test-1',
          },
        },
      },
    });

    render(<Docflow />);

    expect(await screen.findByText('Метаданные заданий 1С требуют настройки')).toBeInTheDocument();
    expect(screen.getByText('Код обращения: corr-test-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('confirms an allowlisted action and sends it exactly once', async () => {
    const taskRef = '11111111-1111-1111-1111-111111111111';
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{
        ref: taskRef,
        title: 'HUB-IT TEST · Согласовать договор',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: false,
      }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    const actionTask = {
      ref: taskRef,
      title: 'HUB-IT TEST · Согласовать договор',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задача исполнителя',
      completed: false,
      state_token: 'signed-state-token-for-test',
      available_actions: [{
        code: 'approve',
        label: 'Согласовать',
        tone: 'success',
        comment_mode: 'optional',
      }],
      files: [],
    };
    docflowAPI.getTask.mockResolvedValue(actionTask);
    docflowAPI.applyTaskAction.mockResolvedValue({
      command_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'applied',
      correlation_id: 'corr-action',
      task: { ...actionTask, completed: true, available_actions: [], state_token: null },
    });

    render(<Docflow />);
    fireEvent.click((await screen.findByText('HUB-IT TEST · Согласовать договор')).closest('[role="button"]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Согласовать' }));
    expect(screen.getByText(/изменено непосредственно в 1С/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Согласовать' }).at(-1));

    await waitFor(() => expect(docflowAPI.applyTaskAction).toHaveBeenCalledTimes(1));
    expect(docflowAPI.applyTaskAction).toHaveBeenCalledWith(
      taskRef,
      { action: 'approve', comment: '', state_token: 'signed-state-token-for-test' },
      expect.any(String),
    );
    expect(await screen.findByText('1С подтвердила выполнение задания.')).toBeInTheDocument();
  });

  it('allows a manual retry only after 1C confirms the previous action was not applied', async () => {
    const taskRef = '11111111-1111-1111-1111-111111111111';
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{
        ref: taskRef,
        title: 'Согласовать договор',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: false,
      }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    const action = {
      code: 'approve',
      label: 'Согласовать',
      tone: 'success',
      comment_mode: 'optional',
    };
    const actionTask = {
      ref: taskRef,
      title: 'Согласовать договор',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задача исполнителя',
      completed: false,
      state_token: 'signed-state-token-before',
      available_actions: [action],
      files: [],
    };
    const retryTask = {
      ...actionTask,
      state_token: 'signed-state-token-after-check',
    };
    docflowAPI.getTask.mockResolvedValue(actionTask);
    docflowAPI.applyTaskAction.mockResolvedValue({
      command_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'state_unknown',
      correlation_id: 'corr-unknown',
      task: null,
      error_code: 'DOCFLOW_ACTION_STATE_UNKNOWN',
    });
    docflowAPI.getCommand.mockResolvedValue({
      command_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'rejected',
      correlation_id: 'corr-check',
      task: retryTask,
      error_code: 'DOCFLOW_ACTION_NOT_APPLIED',
    });

    render(<Docflow />);
    fireEvent.click((await screen.findByText('Согласовать договор')).closest('[role="button"]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Согласовать' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Согласовать' }).at(-1));

    expect(await screen.findByText(/Проверяем результат в 1С/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Действие с заданием' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(await screen.findByText(/1С не применила действие/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Согласовать' })).toBeInTheDocument();
    expect(docflowAPI.applyTaskAction).toHaveBeenCalledTimes(1);
    expect(docflowAPI.getCommand).toHaveBeenCalledTimes(1);
  });

  it('requires a comment for approval with comments and sends the new action code once', async () => {
    const taskRef = '11111111-1111-1111-1111-111111111111';
    docflowAPI.getProfile.mockResolvedValue({ configured: true, login: 'personal.login', status: 'valid' });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{ ref: taskRef, title: 'Согласовать с замечаниями', completed: false }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    const task = {
      ref: taskRef,
      title: 'Согласовать с замечаниями',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задание исполнителя',
      completed: false,
      state_token: 'signed-state-token-for-comments',
      available_actions: [{
        code: 'approve_with_comments',
        label: 'Согласовать с замечаниями',
        tone: 'warning',
        comment_mode: 'required',
      }],
      files: [],
    };
    docflowAPI.getTask.mockResolvedValue(task);
    docflowAPI.applyTaskAction.mockResolvedValue({
      command_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'applied',
      correlation_id: 'corr-comments',
      task: { ...task, completed: true, available_actions: [], state_token: null },
    });

    render(<Docflow />);
    fireEvent.click((await screen.findByText('Согласовать с замечаниями')).closest('[role="button"]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Согласовать с замечаниями' }));
    const confirmButton = screen.getAllByRole('button', { name: 'Согласовать с замечаниями' }).at(-1);
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Комментарий или результат *'), { target: { value: 'Есть замечание' } });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(docflowAPI.applyTaskAction).toHaveBeenCalledTimes(1));
    expect(docflowAPI.applyTaskAction).toHaveBeenCalledWith(
      taskRef,
      { action: 'approve_with_comments', comment: 'Есть замечание', state_token: 'signed-state-token-for-comments' },
      expect.any(String),
    );
  });

  it('shows only the official 1C link when a task requires a digital signature', async () => {
    const taskRef = '22222222-2222-2222-2222-222222222222';
    docflowAPI.getProfile.mockResolvedValue({ configured: true, login: 'personal.login', status: 'valid' });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{ ref: taskRef, title: 'Подписать документ', completed: false }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    docflowAPI.getTask.mockResolvedValue({
      ref: taskRef,
      title: 'Подписать документ',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задание исполнителя',
      completed: false,
      requires_digital_signature: true,
      open_in_1c_url: 'https://docflow.example/1c',
      action_unavailable_reason: 'Для этого задания требуется электронная подпись. Выполните действие в 1С.',
      available_actions: [],
      files: [],
    });

    render(<Docflow />);
    fireEvent.click((await screen.findByText('Подписать документ')).closest('[role="button"]'));

    const link = await screen.findByRole('link', { name: 'Выполнить в 1С' });
    expect(link).toHaveAttribute('href', 'https://docflow.example/1c');
    expect(screen.queryByRole('button', { name: 'Согласовать' })).not.toBeInTheDocument();
  });
});
