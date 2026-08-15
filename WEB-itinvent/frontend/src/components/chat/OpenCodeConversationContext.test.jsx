import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/chatAiSandbox', () => ({
  chatAiSandboxAPI: {
    getConversation: vi.fn(),
    respondPermission: vi.fn(),
    attachArchive: vi.fn(),
    attachFile: vi.fn(),
  },
}));

vi.mock('../../api/chatDirectory', () => ({
  chatDirectoryAPI: {
    saveAttachmentToMyFiles: vi.fn(),
  },
}));

import { chatAiSandboxAPI } from '../../api/chatAiSandbox';
import { chatDirectoryAPI } from '../../api/chatDirectory';
import OpenCodeConversationContext from './OpenCodeConversationContext';
import { CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT } from '../../lib/chatSocket';

const theme = createTheme();

describe('OpenCodeConversationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatAiSandboxAPI.getConversation.mockResolvedValue({
      enabled: true,
      session: { id: 'session-1', status: 'active' },
      job: { id: 'job-1', status: 'waiting_permission' },
      files: [{
        id: 'file-1',
        path: 'src/report.py',
        kind: 'changed',
        changed: true,
        download_url: '/api/v1/chat/ai/sandbox/files/file-1/download',
        message_id: 'message-1',
        attachment_id: 'attachment-1',
      }],
      diff: [{ path: 'src/report.py', diff: '+print("ready")' }],
      pending_permissions: [{ id: 'permission-1', tool: 'bash', command: 'pytest -q' }],
      archive: {
        download_url: '/api/v1/chat/ai/sandbox/conversations/conversation-1/archive',
        message_id: 'archive-message',
        attachment_id: 'archive-attachment',
      },
    });
    chatAiSandboxAPI.respondPermission.mockResolvedValue({ ok: true });
    chatAiSandboxAPI.attachArchive.mockResolvedValue({ ok: true });
    chatAiSandboxAPI.attachFile.mockResolvedValue({ ok: true });
    chatDirectoryAPI.saveAttachmentToMyFiles.mockResolvedValue({ id: 'my-file-1' });
  });

  it('shows workspace files, diff, and permission actions without mutating anything before a click', async () => {
    render(
      <ThemeProvider theme={theme}>
        <OpenCodeConversationContext conversationId="conversation-1" refreshKey="revision-1" />
      </ThemeProvider>,
    );

    expect(await screen.findAllByText('src/report.py')).toHaveLength(2);
    expect(screen.getByText('Нужно разрешение')).toBeInTheDocument();
    expect(screen.getByText('pytest -q')).toBeInTheDocument();
    expect(screen.getByText('+print("ready")')).toBeInTheDocument();
    expect(chatAiSandboxAPI.respondPermission).not.toHaveBeenCalled();
    expect(chatAiSandboxAPI.attachFile).not.toHaveBeenCalled();
    expect(chatDirectoryAPI.saveAttachmentToMyFiles).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT, {
        detail: { conversation_id: 'conversation-1', payload: { change: 'permission' } },
      }));
    });
    await waitFor(() => expect(chatAiSandboxAPI.getConversation.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(screen.getByRole('button', { name: 'Разрешить один раз' }));
    await waitFor(() => expect(chatAiSandboxAPI.respondPermission).toHaveBeenCalledWith(
      'permission-1',
      { decision: 'allow', scope: 'once' },
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Прикрепить' }));
    await waitFor(() => expect(chatAiSandboxAPI.attachFile).toHaveBeenCalledWith('file-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в Мои файлы' }));
    await waitFor(() => expect(chatDirectoryAPI.saveAttachmentToMyFiles).toHaveBeenCalledWith(
      'message-1',
      'attachment-1',
    ));
    expect(await screen.findByText('Файл отправлен на проверку и сохранение в «Мои файлы».')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Прикрепить архив' }));
    await waitFor(() => expect(chatAiSandboxAPI.attachArchive).toHaveBeenCalledWith('conversation-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить архив в Мои файлы' }));
    await waitFor(() => expect(chatDirectoryAPI.saveAttachmentToMyFiles).toHaveBeenCalledWith(
      'archive-message',
      'archive-attachment',
    ));
    expect(await screen.findByText('Архив отправлен на проверку и сохранение в «Мои файлы».')).toBeInTheDocument();
  });

  it('does not render a cross-origin download URL returned by an untrusted payload', async () => {
    chatAiSandboxAPI.getConversation.mockResolvedValue({
      enabled: true,
      files: [{ id: 'file-2', path: 'result.txt', download_url: 'https://example.invalid/result.txt' }],
      diff: [],
      pending_permissions: [],
    });

    render(
      <ThemeProvider theme={theme}>
        <OpenCodeConversationContext conversationId="conversation-2" />
      </ThemeProvider>,
    );

    expect(await screen.findByText('result.txt')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Скачать' })).not.toBeInTheDocument();
  });

  it('keeps pending and unavailable outputs visibly non-actionable', async () => {
    chatAiSandboxAPI.getConversation.mockResolvedValue({
      enabled: true,
      files: [
        {
          id: 'file-pending',
          path: 'pending.txt',
          kind: 'output',
          availability: 'pending',
          download_url: '/api/v1/chat/messages/message-pending/attachments/attachment-pending/file',
        },
        {
          id: 'file-unavailable',
          path: 'unavailable.txt',
          kind: 'changed',
          availability: 'unavailable',
          message_id: 'message-unavailable',
          attachment_id: 'attachment-unavailable',
        },
      ],
      diff: [],
      pending_permissions: [],
    });

    render(
      <ThemeProvider theme={theme}>
        <OpenCodeConversationContext conversationId="conversation-partial" />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Проверяется')).toBeInTheDocument();
    expect(screen.getByText('Недоступен')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Скачать' })).not.toBeInTheDocument();
    const attachButtons = screen.getAllByRole('button', { name: 'Прикрепить' });
    expect(attachButtons).toHaveLength(2);
    attachButtons.forEach((button) => expect(button).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'Сохранить в Мои файлы' })).not.toBeInTheDocument();
  });

  it('treats a 404 as a quiet feature-off state', async () => {
    chatAiSandboxAPI.getConversation.mockRejectedValue({ response: { status: 404 } });

    render(
      <ThemeProvider theme={theme}>
        <OpenCodeConversationContext conversationId="conversation-disabled" />
      </ThemeProvider>,
    );

    expect(await screen.findByText('OpenCode сейчас отключён для этого диалога.')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить состояние OpenCode workspace.')).not.toBeInTheDocument();
  });
});
