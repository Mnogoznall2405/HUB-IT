import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Docflow, { resolveCredentialLogin } from './Docflow';
import { docflowAPI } from '../api/docflow';
import { writeDocflowTasksCache } from './docflow/docflowTasksCache';


const { useMediaQueryMock, authUser } = vi.hoisted(() => ({
  useMediaQueryMock: vi.fn(),
  authUser: { username: 'kozlovskii_me', id: 1, full_name: 'Козловский Максим Евгеньевич' },
}));

function setMuiInputValue(element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  fireEvent.input(element, { target: { value } });
  fireEvent.change(element, { target: { value } });
}

vi.mock('@mui/material/useMediaQuery', () => ({
  default: useMediaQueryMock,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authUser,
    hasPermission: () => true,
  }),
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
    getFilePreview: vi.fn(),
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
    sessionStorage.clear();
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
    docflowAPI.getFilePreview.mockReset();
    docflowAPI.downloadFilePreviewPdf.mockReset();
    docflowAPI.getFilePreview.mockResolvedValue({
      status: 'ready',
      preview_kind: 'office_pdf',
      source_kind: 'word',
      pdf_filename: 'preview.pdf',
      page_count: 1,
      sheets: [],
    });
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

  it('builds 1C login from full name as Surname + initials', () => {
    expect(resolveCredentialLogin(
      { login: null },
      { username: 'kozlovskii_me', full_name: 'Козловский Максим Евгеньевич' },
    )).toBe('КозловскийМЕ');
    expect(resolveCredentialLogin(
      { login: 'saved.1c.login' },
      { username: 'kozlovskii_me', full_name: 'Козловский Максим Евгеньевич' },
    )).toBe('saved.1c.login');
    expect(resolveCredentialLogin(
      { login: null },
      { username: 'kozlovskii_me', full_name: '' },
    )).toBe('kozlovskii_me');
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
    expect(screen.getByText('personal.login')).toBeInTheDocument();
    expect(screen.getByText('Подключено')).toBeInTheDocument();
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
    expect(docflowAPI.searchAssignmentDocuments).not.toHaveBeenCalled();
    await waitFor(() => expect(docflowAPI.searchAssignmentAssignees).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Документ должен уже существовать в 1С/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Найти' })[0]);
    expect(docflowAPI.searchAssignmentDocuments).not.toHaveBeenCalled();
    expect(screen.getByText(/не менее 3 символов/i)).toBeInTheDocument();
    setMuiInputValue(screen.getByLabelText('Документ 1С *'), 'HUB');
    fireEvent.click(screen.getAllByRole('button', { name: 'Найти' })[0]);
    await waitFor(() => expect(docflowAPI.searchAssignmentDocuments).toHaveBeenCalledWith({ q: 'HUB', limit: 20 }));

    fireEvent.click(await screen.findByRole('option', { name: /HUB-IT TEST документ/i }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Исполнитель/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Тестовый исполнитель/i }));
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
    await waitFor(() => expect(docflowAPI.listTasks).toHaveBeenCalled());
  });

  it('shows assignment CTA on mobile and keeps document search independent from assignees', async () => {
    useMediaQueryMock.mockReturnValue(true);
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
        title: 'Документ для поиска',
        number: '7',
      }],
      returned: 1,
      truncated: false,
    });
    docflowAPI.searchAssignmentAssignees.mockResolvedValue({ items: [], returned: 0, truncated: false });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать поручение' }));
    expect(docflowAPI.searchAssignmentDocuments).not.toHaveBeenCalled();
    await waitFor(() => expect(docflowAPI.searchAssignmentAssignees).toHaveBeenCalledTimes(1));
    const assigneeCalls = docflowAPI.searchAssignmentAssignees.mock.calls.length;

    setMuiInputValue(screen.getByLabelText('Документ 1С *'), 'док');
    fireEvent.click(screen.getAllByRole('button', { name: 'Найти' })[0]);
    await waitFor(() => expect(docflowAPI.searchAssignmentDocuments).toHaveBeenCalledTimes(1));
    expect(docflowAPI.searchAssignmentAssignees).toHaveBeenCalledTimes(assigneeCalls);

    fireEvent.click(screen.getAllByRole('button', { name: 'Найти' })[1]);
    await waitFor(() => expect(docflowAPI.searchAssignmentAssignees).toHaveBeenCalledTimes(assigneeCalls + 1));
    expect(docflowAPI.searchAssignmentDocuments).toHaveBeenCalledTimes(1);
  });

  it('shows capability reason when assignment create is disabled', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.getAssignmentCapability.mockResolvedValue({
      enabled: false,
      reason: 'Создание поручений выключено на сервере.',
    });

    render(<Docflow />);
    const createButton = await screen.findByRole('button', { name: 'Создать поручение' });
    expect(createButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Ещё действия подключения'));
    expect(await screen.findByText('Создание поручений выключено на сервере.')).toBeInTheDocument();
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
    expect(docflowAPI.getFilePreview).toHaveBeenCalledWith(
      taskRef,
      fileRef,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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
      as_of: '2026-07-30T10:00:00Z',
    });

    render(<Docflow />);

    expect(await screen.findByRole('button', { name: 'Согласование', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завершённые' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Все' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Согласовать договор').closest('[role="button"]'));
    expect(await screen.findByRole('button', { name: 'Закрыть карточку задания' })).toBeInTheDocument();
  });

  it('filters the loaded task list as the user types a search query', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [
        {
          ref: 'mobile-task-1',
          title: 'Согласовать договор',
          task_type: 'ЗадачаИсполнителя',
          task_type_label: 'Задача исполнителя',
          completed: false,
        },
        {
          ref: 'mobile-task-2',
          title: 'О проведении совещания',
          task_type: 'ЗадачаИсполнителя',
          task_type_label: 'Задача исполнителя',
          completed: true,
        },
      ],
      returned: 2,
      scope: 'all',
      source: 'live_1c',
      truncated: false,
      as_of: '2026-07-30T10:00:00Z',
    });

    render(<Docflow />);
    expect(await screen.findByText('Согласовать договор')).toBeInTheDocument();
    expect(screen.getByText('О проведении совещания')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Поиск по моим заданиям'), { target: { value: 'совещания' } });
    expect(screen.queryByText('Согласовать договор')).not.toBeInTheDocument();
    expect(screen.getByText('О проведении совещания')).toBeInTheDocument();
    expect(screen.getByText(/Найдено: 1/)).toBeInTheDocument();
  });

  it('sends a password only from the dialog and clears it after save', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: false,
      login: null,
      status: 'not_configured',
    });
    docflowAPI.saveCredentials.mockResolvedValue({
      configured: true,
      login: 'КозловскийМЕ',
      status: 'valid',
    });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));

    expect(await screen.findByLabelText(/Логин 1С/)).toHaveValue('КозловскийМЕ');
    expect(screen.queryByText(/Введите личный логин и пароль/)).not.toBeInTheDocument();
    expect(screen.queryByText(/хранятся в зашифрованном виде/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Пароль 1С/), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить и сохранить' }));

    await waitFor(() => expect(docflowAPI.saveCredentials).toHaveBeenCalledWith({
      login: 'КозловскийМЕ',
      password: 'temporary-password',
    }));
    await waitFor(() => expect(screen.queryByLabelText(/Пароль 1С/)).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('temporary-password')).not.toBeInTheDocument();
  });

  it('prefills saved profile login over hub username and allows editing it', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'saved.1c.login',
      status: 'valid',
    });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё действия подключения' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Настроить' }));

    const loginField = await screen.findByLabelText(/Логин 1С/);
    expect(loginField).toHaveValue('saved.1c.login');
    fireEvent.change(loginField, { target: { value: 'other.1c.login' } });
    expect(loginField).toHaveValue('other.1c.login');
  });

  it('clears an unsaved password when the credentials dialog closes', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: false,
      login: null,
      status: 'not_configured',
    });

    render(<Docflow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));
    fireEvent.change(await screen.findByLabelText(/Пароль 1С/), { target: { value: 'temporary-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));

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
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));

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
    expect(screen.getByText('Завершено')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).not.toBeInTheDocument();
  });

  it('marks the card completed even when apply returns a stale incomplete task', async () => {
    const taskRef = '11111111-1111-1111-1111-111111111112';
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{
        ref: taskRef,
        title: 'HUB-IT TEST · Устаревший ответ',
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
      title: 'HUB-IT TEST · Устаревший ответ',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задача исполнителя',
      completed: false,
      state_token: 'signed-state-token-stale',
      available_actions: [{
        code: 'approve',
        label: 'Согласовать',
        tone: 'success',
        comment_mode: 'optional',
      }],
      files: [],
    };
    docflowAPI.getTask
      .mockResolvedValueOnce(actionTask)
      .mockResolvedValueOnce({ ...actionTask, completed: false, available_actions: actionTask.available_actions });
    docflowAPI.applyTaskAction.mockResolvedValue({
      command_id: 'cccccccccccccccccccccccccccccccc',
      status: 'applied',
      correlation_id: 'corr-stale',
      task: { ...actionTask, completed: false, available_actions: actionTask.available_actions },
    });

    render(<Docflow />);
    fireEvent.click((await screen.findByText('HUB-IT TEST · Устаревший ответ')).closest('[role="button"]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Согласовать' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Согласовать' }).at(-1));

    expect(await screen.findByText('1С подтвердила выполнение задания.')).toBeInTheDocument();
    expect(screen.getByText('Завершено')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: 'Проверить' })).toBeInTheDocument();
    expect(screen.getByText(/Не нажимайте действие повторно/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(await screen.findByText(/1С не применила действие/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Согласовать' })).toBeInTheDocument();
    expect(docflowAPI.applyTaskAction).toHaveBeenCalledTimes(1);
    expect(docflowAPI.getCommand).toHaveBeenCalledTimes(1);
  });

  it('shows action progress spinner until 1C confirms completion', async () => {
    const taskRef = '11111111-1111-1111-1111-111111111199';
    docflowAPI.getProfile.mockResolvedValue({ configured: true, login: 'personal.login', status: 'valid' });
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
    const actionTask = {
      ref: taskRef,
      title: 'Согласовать договор',
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Задача исполнителя',
      completed: false,
      state_token: 'signed-state-token-progress',
      available_actions: [{
        code: 'approve',
        label: 'Согласовать',
        tone: 'success',
        comment_mode: 'optional',
      }],
      files: [],
    };
    docflowAPI.getTask.mockResolvedValue(actionTask);
    let resolveApply;
    docflowAPI.applyTaskAction.mockReturnValue(new Promise((resolve) => {
      resolveApply = resolve;
    }));

    render(<Docflow />);
    fireEvent.click((await screen.findByText('Согласовать договор')).closest('[role="button"]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Согласовать' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Согласовать' }).at(-1));

    expect(await screen.findByRole('heading', { name: 'Выполнение в 1С' })).toBeInTheDocument();
    expect(screen.getByText(/Отправляем действие в 1С и ждём ответ/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    resolveApply({
      command_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'applied',
      correlation_id: 'corr-progress',
      task: { ...actionTask, completed: true, available_actions: [], state_token: null },
    });

    expect(await screen.findByText('1С подтвердила выполнение задания.')).toBeInTheDocument();
    expect(screen.getByText('Завершено')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Выполнение в 1С' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Согласовать' })).not.toBeInTheDocument();
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
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    expect(screen.getByText('Введите комментарий — без него действие выполнить нельзя.')).toBeInTheDocument();
    expect(docflowAPI.applyTaskAction).not.toHaveBeenCalled();
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

  it('clamps a long detail title behind expand and keeps approve action in the footer', async () => {
    const taskRef = '33333333-3333-3333-3333-333333333333';
    const longTitle = 'Об утверждении Инструкции по организации работы с документами, содержащими служебную информацию ограниченного распространения (№ ГФ/УД-16/пп от 22.01.2025)';
    docflowAPI.getProfile.mockResolvedValue({ configured: true, login: 'personal.login', status: 'valid' });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{
        ref: taskRef,
        title: longTitle,
        completed: false,
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Ознакомление',
      }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
    });
    docflowAPI.getTask.mockResolvedValue({
      ref: taskRef,
      title: longTitle,
      task_type: 'ЗадачаИсполнителя',
      task_type_label: 'Ознакомление',
      process_type_label: 'Ознакомление',
      completed: false,
      state_token: 'signed-state-token-long-title',
      available_actions: [{
        code: 'approve',
        label: 'Ознакомился',
        tone: 'success',
        comment_mode: 'optional',
      }],
      files: [],
    });

    render(<Docflow />);
    fireEvent.click((await screen.findByText(longTitle)).closest('[role="button"]'));

    expect(await screen.findByRole('heading', { name: longTitle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать полностью' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ознакомился' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать полностью' }));
    expect(screen.getByRole('button', { name: 'Свернуть' })).toBeInTheDocument();
  });

  it('serves a fresh sessionStorage cache without calling 1C again', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockResolvedValue({
      items: [{
        ref: 'cached-task-1',
        title: 'Кэшированное задание',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: false,
      }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
      as_of: '2026-07-30T10:00:00Z',
    });

    const { unmount } = render(<Docflow />);
    expect(await screen.findByText('Кэшированное задание')).toBeInTheDocument();
    expect(docflowAPI.listTasks).toHaveBeenCalledTimes(1);
    unmount();

    render(<Docflow />);
    expect(await screen.findByText('Кэшированное задание')).toBeInTheDocument();
    expect(docflowAPI.listTasks).toHaveBeenCalledTimes(1);
  });

  it('revalidates a stale cache in the background while keeping the list visible', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    writeDocflowTasksCache({
      login: 'personal.login',
      scope: 'inbox',
      search: '',
      items: [{
        ref: 'cached-task-1',
        title: 'Старое задание',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: false,
      }],
      truncated: false,
      as_of: '2026-07-30T10:00:00Z',
      now: Date.now() - (46 * 1000),
    });

    let releaseRefresh;
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    docflowAPI.listTasks.mockImplementation(() => refreshGate.then(() => ({
      items: [{
        ref: 'cached-task-2',
        title: 'Актуальное задание',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: false,
      }],
      returned: 1,
      scope: 'inbox',
      source: 'live_1c',
      truncated: false,
      as_of: '2026-07-30T10:05:00Z',
    })));

    render(<Docflow />);
    expect(await screen.findByText('Старое задание')).toBeInTheDocument();
    expect(docflowAPI.listTasks).toHaveBeenCalled();

    releaseRefresh();
    expect(await screen.findByText('Актуальное задание')).toBeInTheDocument();
    expect(screen.queryByText('Старое задание')).not.toBeInTheDocument();
  });

  it('forces a live reload when refresh is clicked and uses fresh cache when switching scopes', async () => {
    docflowAPI.getProfile.mockResolvedValue({
      configured: true,
      login: 'personal.login',
      status: 'valid',
    });
    docflowAPI.listTasks.mockImplementation(async ({ scope }) => ({
      items: [{
        ref: `task-${scope}`,
        title: scope === 'completed' ? 'Завершённое задание' : 'Входящее задание',
        task_type: 'ЗадачаИсполнителя',
        task_type_label: 'Задача исполнителя',
        completed: scope === 'completed',
      }],
      returned: 1,
      scope,
      source: 'live_1c',
      truncated: false,
      as_of: '2026-07-30T10:00:00Z',
    }));

    render(<Docflow />);
    expect(await screen.findByText('Входящее задание')).toBeInTheDocument();
    expect(docflowAPI.listTasks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Завершённые' }));
    expect(await screen.findByText('Завершённое задание')).toBeInTheDocument();
    expect(docflowAPI.listTasks).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Согласование' }));
    expect(await screen.findByText('Входящее задание')).toBeInTheDocument();
    expect(docflowAPI.listTasks).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Обновить задания' }));
    await waitFor(() => expect(docflowAPI.listTasks).toHaveBeenCalledTimes(3));
    expect(docflowAPI.listTasks).toHaveBeenLastCalledWith({ scope: 'inbox', q: '', limit: 50 });
  });
});
