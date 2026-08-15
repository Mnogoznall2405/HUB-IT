import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  chatAPI: {
    getAiMemory: vi.fn(),
    updateAiMemorySettings: vi.fn(),
    updateAiMemoryItem: vi.fn(),
    deleteAiMemoryItem: vi.fn(),
    clearAiMemory: vi.fn(),
    resetAiConversationContext: vi.fn(),
  },
}));

import AiConversationContextPanel from './AiConversationContextPanel';
import apiClient, { chatAPI } from '../../api/client';

const theme = createTheme();

describe('AiConversationContextPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatAPI.getAiMemory.mockResolvedValue({ enabled: true, items: [], limits: { max_facts: 20, max_tokens: 4000 } });
    chatAPI.resetAiConversationContext.mockResolvedValue({ ok: true, conversation_id: 'ai-1', context_reset_seq: 4 });
  });

  it('shows user-facing agent context without exposing model or tool identifiers', async () => {
    const onClose = vi.fn();
    const onOpenAttachmentPreview = vi.fn();
    const onCreateNewConversation = vi.fn();
    const onUpdateConversationSettings = vi.fn();
    const attachment = { id: 'file-1', file_name: 'report.xlsx' };

    render(
      <ThemeProvider theme={theme}>
        <AiConversationContextPanel
          activeConversation={{ id: 'ai-1', kind: 'ai', title: 'Оборудование', is_pinned: false, is_archived: false }}
          agent={{
            title: 'HUB Ассистент',
            description: 'Работает с разрешёнными данными HUB.',
            live_data_enabled: true,
            allow_file_input: true,
            allow_generated_artifacts: true,
            model: 'hidden-model-id',
            enabled_tools: ['internal.tool.identifier'],
          }}
          messages={[{
            id: 'msg-1',
            body: 'Источник: ITinvent — карточка сотрудника',
            attachments: [attachment],
          }]}
          onClose={onClose}
          onOpenAttachmentPreview={onOpenAttachmentPreview}
          onCreateNewConversation={onCreateNewConversation}
          onUpdateConversationSettings={onUpdateConversationSettings}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('ai-conversation-context-panel')).toBeInTheDocument();
    expect(screen.getByText('HUB Ассистент')).toBeInTheDocument();
    expect(screen.getByText('Данные HUB')).toBeInTheDocument();
    expect(screen.getByText('В текущем чате учитываются последние 20 сообщений и краткое резюме более ранней части. Личная память может использоваться между AI-чатами.')).toBeInTheDocument();
    expect(screen.getByText('ITinvent — карточка сотрудника')).toBeInTheDocument();
    expect(screen.queryByText('hidden-model-id')).not.toBeInTheDocument();
    expect(screen.queryByText('internal.tool.identifier')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'report.xlsx' }));
    fireEvent.click(screen.getByRole('button', { name: 'Новый чат с этим помощником' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить контекст' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрепить диалог' }));
    fireEvent.click(screen.getByRole('button', { name: 'Архивировать диалог' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть информацию об агенте' }));

    expect(onOpenAttachmentPreview).toHaveBeenCalledWith(attachment);
    expect(onCreateNewConversation).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(chatAPI.resetAiConversationContext).toHaveBeenCalledWith('ai-1'));
    expect(screen.getByText(/Старые сообщения останутся видимыми/i)).toBeInTheDocument();
    expect(onUpdateConversationSettings).toHaveBeenNthCalledWith(1, { is_pinned: true });
    expect(onUpdateConversationSettings).toHaveBeenNthCalledWith(2, { is_archived: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('labels a generic conversation as personal AI instead of using its auto-title as the agent name', async () => {
    render(
      <ThemeProvider theme={theme}>
        <AiConversationContextPanel
          activeConversation={{ id: 'ai-general', kind: 'ai', title: 'Подготовь квартальный отчёт' }}
          agent={null}
          messages={[]}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Сохранённых предпочтений и рабочих фактов пока нет.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Личный AI' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Подготовь квартальный отчёт' })).not.toBeInTheDocument();
    expect(screen.getByText('Создание документов')).toBeInTheDocument();
  });

  it('allows editing, deleting, and disabling personal memory', async () => {
    chatAPI.getAiMemory.mockResolvedValue({
      enabled: true,
      items: [{ id: 'memory-1', content: 'Предпочитает краткие отчёты', category: 'preference' }],
    });
    chatAPI.updateAiMemoryItem.mockResolvedValue({ id: 'memory-1', content: 'Предпочитает отчёты в PDF' });
    chatAPI.deleteAiMemoryItem.mockResolvedValue({ ok: true });
    chatAPI.updateAiMemorySettings.mockResolvedValue({ enabled: false, items: [] });

    render(
      <ThemeProvider theme={theme}>
        <AiConversationContextPanel
          activeConversation={{ id: 'ai-1', kind: 'ai', title: 'Чат' }}
          agent={{ id: 'bot-1', title: 'HUB Ассистент' }}
          messages={[]}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Предпочитает краткие отчёты')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить факт памяти' }));
    const memoryInput = screen.getByLabelText('Что помощнику нужно помнить');
    expect(memoryInput).toHaveAttribute('maxLength', '1000');
    fireEvent.change(memoryInput, { target: { value: 'Предпочитает отчёты в PDF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(chatAPI.updateAiMemoryItem).toHaveBeenCalledWith('memory-1', 'Предпочитает отчёты в PDF'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Изменить факт памяти' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Использовать личную память' }));
    await waitFor(() => expect(chatAPI.updateAiMemorySettings).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить факт памяти' }));
    await waitFor(() => expect(chatAPI.deleteAiMemoryItem).toHaveBeenCalledWith('memory-1'));
  });

  it('keeps memory off when an administrator has disabled it globally', async () => {
    chatAPI.getAiMemory.mockResolvedValue({ enabled: false, items: [] });
    chatAPI.updateAiMemorySettings.mockResolvedValue({ enabled: false, items: [] });

    render(
      <ThemeProvider theme={theme}>
        <AiConversationContextPanel
          activeConversation={{ id: 'ai-1', kind: 'ai', title: 'Чат' }}
          agent={{ id: 'bot-1', title: 'HUB Ассистент' }}
          messages={[]}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    const memorySwitch = await screen.findByRole('checkbox', { name: 'Использовать личную память' });
    expect(memorySwitch).not.toBeChecked();
    fireEvent.click(memorySwitch);

    await waitFor(() => expect(chatAPI.updateAiMemorySettings).toHaveBeenCalledWith(true));
    expect(memorySwitch).not.toBeChecked();
    expect(screen.getByText('Память пока недоступна администратором.')).toBeInTheDocument();
  });

  it('opens the OpenCode workspace only for an agent with the sandbox surface', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        enabled: true,
        session: null,
        job: null,
        files: [],
        diff: [],
        pending_permissions: [],
        archive: null,
      },
    });
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <AiConversationContextPanel
          activeConversation={{ id: 'ai-1', kind: 'ai', title: 'OpenCode' }}
          agent={{ slug: 'opencode', title: 'OpenCode', surface: 'corporate' }}
          messages={[]}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.queryByText('OpenCode workspace')).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();

    rerender(
      <ThemeProvider theme={theme}>
        <AiConversationContextPanel
          activeConversation={{ id: 'ai-1', kind: 'ai', title: 'OpenCode' }}
          agent={{ slug: 'renamed-agent', title: 'OpenCode', surface: 'sandbox' }}
          messages={[]}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByText('OpenCode workspace')).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/chat/ai/sandbox/conversations/ai-1'));
  });
});
