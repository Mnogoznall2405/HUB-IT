import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatContextPanel from './ChatContextPanel';

const chatApiMock = vi.hoisted(() => ({
  getConversationAssetsSummary: vi.fn(),
  getConversationAttachments: vi.fn(),
}));

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    chatAPI: chatApiMock,
  };
});

const theme = createTheme();
const ui = {
  borderSoft: 'rgba(148,163,184,0.2)',
  panelBg: '#0f172a',
  pageBg: '#020617',
  textSecondary: '#94a3b8',
};

const groupConversation = {
  id: 'conv-1',
  title: 'Маркетинг',
  kind: 'group',
  member_count: 2,
  is_pinned: false,
  is_muted: false,
  is_archived: false,
  last_message_at: '2026-03-25T10:00:00Z',
  updated_at: '2026-03-25T10:00:00Z',
  members: [
    {
      user: {
        id: 1,
        full_name: 'Иван Петров',
        username: 'ivan.petrov',
        department: 'ИТ',
        job_title: 'Системный администратор',
        city: 'Тюмень',
        corporate_email: 'ivan.petrov@zsgp.ru',
        corporate_phone: '+7 (3452) 12-34-56',
        work_profile_source: 'zup',
        presence: { is_online: true, status_text: 'В сети' },
      },
    },
    {
      user: {
        id: 2,
        full_name: 'Мария Соколова',
        username: 'm.sokolova',
        presence: { is_online: false, status_text: 'Была недавно' },
      },
    },
  ],
};

const directConversation = {
  id: 'conv-2',
  title: 'Андрей',
  kind: 'direct',
  member_count: 2,
  is_pinned: true,
  is_muted: true,
  is_archived: false,
  last_message_at: '2026-03-25T12:30:00Z',
  updated_at: '2026-03-25T12:30:00Z',
  direct_peer: {
    id: 42,
    full_name: 'Андрей Петров',
    username: 'andrey.petrov',
    role: 'operator',
    department: 'Проектный офис',
    job_title: 'Руководитель проекта',
    city: 'Москва',
    corporate_email: 'andrey.petrov@zsgp.ru',
    corporate_phone: '+7 (495) 123-45-67',
    work_profile_source: 'zup',
    presence: { is_online: false, status_text: 'Был(а) недавно' },
  },
  members: [],
};

const taskConversation = {
  id: 'conv-task-1',
  title: 'Согласование макета',
  kind: 'task',
  task_id: 'task-42',
  member_count: 3,
  is_pinned: false,
  is_muted: false,
  is_archived: false,
  members: [],
};

const largeGroupConversation = {
  ...groupConversation,
  id: 'conv-large',
  member_count: 10,
  members: Array.from({ length: 10 }, (_, index) => ({
    user: {
      id: index + 1,
      full_name: `Person ${String(index + 1).padStart(2, '0')}`,
      username: `person.${String(index + 1).padStart(2, '0')}`,
      presence: { is_online: index % 2 === 0, status_text: index % 2 === 0 ? 'Online' : 'Offline' },
    },
  })),
};

const renderWithTheme = (props) => render(
  <ThemeProvider theme={theme}>
    <ChatContextPanel {...props} />
  </ThemeProvider>,
);

const buildProps = (overrides = {}) => ({
  theme,
  ui,
  activeConversation: groupConversation,
  conversationHeaderSubtitle: '2 участника • 1 онлайн',
  socketStatus: 'connected',
  messages: [],
  open: true,
  onToggleOpen: vi.fn(),
  onOpenSearch: vi.fn(),
  onOpenShare: vi.fn(),
  onOpenFilePicker: vi.fn(),
  onUpdateConversationSettings: vi.fn(),
  settingsUpdating: false,
  onOpenAttachmentPreview: vi.fn(),
  onOpenTask: vi.fn(),
  ...overrides,
});

describe('ChatContextPanel', () => {
  beforeEach(() => {
    chatApiMock.getConversationAssetsSummary.mockReset();
    chatApiMock.getConversationAttachments.mockReset();
    chatApiMock.getConversationAssetsSummary.mockResolvedValue({
      photos_count: 1,
      videos_count: 0,
      files_count: 2,
      audio_count: 0,
      shared_tasks_count: 3,
      recent_photos: [],
      recent_videos: [],
      recent_files: [],
      recent_audio: [],
    });
    chatApiMock.getConversationAttachments.mockResolvedValue({
      items: [
        {
          id: 'att-1',
          message_id: 'msg-1',
          kind: 'image',
          file_name: 'photo.png',
          mime_type: 'image/png',
          file_size: 1024,
          created_at: '2026-03-25T10:00:00Z',
        },
      ],
      has_more: false,
      next_before_attachment_id: null,
    });
  });

  it.each([
    ['личном чате', directConversation, false, { is_muted: false }],
    ['беседе', groupConversation, true, { is_muted: true }],
    ['диалоге задачи', taskConversation, true, { is_muted: true }],
  ])('переключает уведомления прямо в %s', async (_, activeConversation, initiallyChecked, expectedUpdate) => {
    const onUpdateConversationSettings = vi.fn();

    renderWithTheme(buildProps({
      activeConversation,
      onUpdateConversationSettings,
    }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith(activeConversation.id));
    const toggle = screen.getByRole('checkbox', { name: 'Уведомления для этого чата' });

    expect(toggle).toHaveProperty('checked', initiallyChecked);
    fireEvent.click(toggle);
    expect(onUpdateConversationSettings).toHaveBeenCalledWith(expectedUpdate);
  });

  it('loads media browser data and opens image preview', async () => {
    const onOpenAttachmentPreview = vi.fn();

    renderWithTheme(buildProps({ onOpenAttachmentPreview }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-1'));
    await waitFor(() => expect(chatApiMock.getConversationAttachments).toHaveBeenCalledWith('conv-1', {
      kind: 'image',
      limit: 12,
      before_attachment_id: undefined,
    }));

    fireEvent.click(screen.getByAltText('photo.png'));
    expect(onOpenAttachmentPreview).toHaveBeenCalledWith('msg-1', expect.objectContaining({ id: 'att-1' }));
    expect(screen.getAllByText(/Фото/).length).toBeGreaterThan(0);
  });

  it('requests video attachments when the user opens the video section', async () => {
    chatApiMock.getConversationAssetsSummary.mockResolvedValueOnce({
      photos_count: 1,
      videos_count: 1,
      files_count: 0,
      audio_count: 0,
      shared_tasks_count: 0,
      recent_photos: [],
      recent_videos: [],
      recent_files: [],
      recent_audio: [],
    });
    chatApiMock.getConversationAttachments
      .mockResolvedValueOnce({
        items: [
          {
            id: 'att-image-1',
            message_id: 'msg-image-1',
            kind: 'image',
            file_name: 'photo.png',
            mime_type: 'image/png',
            file_size: 1024,
            created_at: '2026-03-25T10:00:00Z',
          },
        ],
        has_more: false,
        next_before_attachment_id: null,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'att-video-1',
            message_id: 'msg-video-1',
            kind: 'video',
            file_name: 'clip.mp4',
            mime_type: 'video/mp4',
            file_size: 4096,
            created_at: '2026-03-25T11:00:00Z',
            variant_urls: {
              poster: '/api/v1/chat/messages/msg-video-1/attachments/att-video-1/file?inline=1&variant=poster',
            },
          },
        ],
        has_more: false,
        next_before_attachment_id: null,
      });

    renderWithTheme(buildProps());

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-1'));

    fireEvent.click(screen.getByRole('button', { name: /Видео/i }));

    await waitFor(() => expect(chatApiMock.getConversationAttachments).toHaveBeenLastCalledWith('conv-1', {
      kind: 'video',
      limit: 12,
      before_attachment_id: undefined,
    }));
    expect(screen.getByRole('img', { name: /clip\.mp4/i })).toBeInTheDocument();
  });

  it('renders direct chat info, opens shared task rows and does not show group participant toggle', async () => {
    const onOpenTask = vi.fn();
    chatApiMock.getConversationAssetsSummary.mockResolvedValueOnce({
      photos_count: 0,
      files_count: 0,
      audio_count: 0,
      shared_tasks_count: 1,
      recent_photos: [],
      recent_files: [],
      recent_audio: [],
    });

    renderWithTheme(buildProps({
      activeConversation: directConversation,
      conversationHeaderSubtitle: 'Был(а) недавно',
      messages: [
        {
          id: 'msg-task-1',
          kind: 'task_share',
          created_at: '2026-03-25T12:00:00Z',
          task_preview: {
            id: 'task-7',
            title: 'Согласовать макет',
            status: 'review',
            priority: 'high',
            assignee_full_name: 'Мария Соколова',
            due_at: '2026-03-28T09:00:00Z',
          },
        },
      ],
      onOpenTask,
    }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-2'));
    expect(screen.getByText('Корпоративная почта')).toBeInTheDocument();
    expect(screen.getByText('andrey.petrov@zsgp.ru')).toBeInTheDocument();
    expect(screen.getByText('Корпоративный телефон')).toBeInTheDocument();
    expect(screen.getByText('+7 (495) 123-45-67')).toBeInTheDocument();
    expect(screen.getByText('Руководитель проекта')).toBeInTheDocument();
    expect(screen.getByText('Проектный офис')).toBeInTheDocument();
    expect(screen.getByText('Москва')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Показать всех/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть карточку Андрей Петров' }));
    const profileDialog = screen.getByRole('dialog', { name: 'Карточка сотрудника' });
    expect(within(profileDialog).getByText('Руководитель проекта')).toBeInTheDocument();
    expect(within(profileDialog).getByText('Проектный офис')).toBeInTheDocument();
    expect(within(profileDialog).getByText('Москва')).toBeInTheDocument();
    expect(within(profileDialog).getByText('andrey.petrov@zsgp.ru')).toBeInTheDocument();
    expect(within(profileDialog).getByText('+7 (495) 123-45-67')).toBeInTheDocument();
    expect(within(profileDialog).queryByText('Учётная запись')).not.toBeInTheDocument();
    expect(within(profileDialog).queryByText('Источник данных')).not.toBeInTheDocument();
    expect(within(profileDialog).queryByText('1С:ЗУП')).not.toBeInTheDocument();
    fireEvent.click(within(profileDialog).getByRole('button', { name: 'Закрыть карточку сотрудника' }));

    fireEvent.click(screen.getByText(/^Задачи/));
    fireEvent.click(screen.getByText(/Согласовать макет/i));
    expect(onOpenTask).toHaveBeenCalledWith('task-7');
  });

  it('shows collapsed rail and restores open action', async () => {
    renderWithTheme(buildProps({ open: false }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Открыть контекст чата/i })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('opens an embedded profile panel after starting closed without crashing', async () => {
    const { rerender } = renderWithTheme(buildProps({ embedded: true, open: false }));

    expect(screen.queryByText('Информация')).not.toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ChatContextPanel
          {...buildProps({
            embedded: true,
            open: true,
          })}
        />
      </ThemeProvider>,
    );

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-1'));
    expect(screen.getByText('Информация')).toBeInTheDocument();
    expect(screen.getAllByText(/Фото/).length).toBeGreaterThan(0);
  });

  it('renders the mobile full-screen profile layout for chat info', async () => {
    renderWithTheme(buildProps({
      activeConversation: directConversation,
      conversationHeaderSubtitle: 'Был(а) недавно',
      mobileScreen: true,
      embedded: true,
    }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-2'));
    expect(screen.getByLabelText('Закрыть информацию')).toBeInTheDocument();
    expect(screen.getByText('Информация')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Уведомления для этого чата' })).not.toBeChecked();
    expect(screen.getByText('Выключены, кроме личных упоминаний')).toBeInTheDocument();
    expect(screen.getByText(/Фото/)).toBeInTheDocument();
    expect(screen.getByText('Файлы')).toBeInTheDocument();
    expect(screen.getByText('Ссылки')).toBeInTheDocument();
    expect(screen.getByText('Задачи')).toBeInTheDocument();
  });

  it('keeps the mobile files tab open when the conversation has no files', async () => {
    chatApiMock.getConversationAssetsSummary.mockResolvedValueOnce({
      photos_count: 0,
      files_count: 0,
      audio_count: 0,
      shared_tasks_count: 0,
      recent_photos: [],
      recent_files: [],
      recent_audio: [],
    });
    chatApiMock.getConversationAttachments
      .mockResolvedValueOnce({
        items: [],
        has_more: false,
        next_before_attachment_id: null,
      })
      .mockResolvedValueOnce({
        items: [],
        has_more: false,
        next_before_attachment_id: null,
      });

    renderWithTheme(buildProps({
      activeConversation: directConversation,
      conversationHeaderSubtitle: 'Был(а) недавно',
      mobileScreen: true,
      embedded: true,
    }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-2'));

    fireEvent.click(within(screen.getByTestId('chat-context-mobile-tabs')).getAllByRole('button')[1]);

    await waitFor(() => expect(chatApiMock.getConversationAttachments).toHaveBeenLastCalledWith('conv-2', {
      kind: 'file',
      limit: 12,
      before_attachment_id: undefined,
    }));
    expect(screen.getByTestId('chat-context-mobile-tab-content').textContent?.trim().length).toBeGreaterThan(0);
  });

  it('expands the full participant list and resets it after conversation change', async () => {
    const { rerender } = renderWithTheme(buildProps({
      activeConversation: largeGroupConversation,
      conversationHeaderSubtitle: '10 participants',
      mobileScreen: true,
      embedded: true,
    }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-large'));
    fireEvent.click(screen.getAllByText(/^Участники/)[1]);
    expect(screen.getByText('Person 01')).toBeInTheDocument();
    expect(screen.queryByText('Person 10')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Показать всех/i }));
    expect(screen.getByText('Person 10')).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ChatContextPanel
          {...buildProps({
            activeConversation: {
              ...largeGroupConversation,
              id: 'conv-large-2',
              title: 'Another Team',
            },
            conversationHeaderSubtitle: '10 participants',
            mobileScreen: true,
            embedded: true,
          })}
        />
      </ThemeProvider>,
    );

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-large-2'));
    fireEvent.click(screen.getAllByText(/^Участники/)[1]);
    expect(screen.queryByText('Person 10')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Показать всех/i })).toBeInTheDocument();
  });

  it('opens a group participant card with workplace context', async () => {
    renderWithTheme(buildProps());

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-1'));
    fireEvent.click(screen.getAllByText(/^Участники/)[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть карточку Иван Петров' }));

    const dialog = screen.getByRole('dialog', { name: 'Карточка участника' });
    expect(within(dialog).getByText('Иван Петров')).toBeInTheDocument();
    expect(within(dialog).getByText('Системный администратор')).toBeInTheDocument();
    expect(within(dialog).getByText('ИТ')).toBeInTheDocument();
    expect(within(dialog).getByText('Тюмень')).toBeInTheDocument();
    expect(within(dialog).getByText('ivan.petrov@zsgp.ru')).toBeInTheDocument();
    expect(within(dialog).getByText('+7 (3452) 12-34-56')).toBeInTheDocument();
    expect(within(dialog).queryByText('Учётная запись')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Источник данных')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('1С:ЗУП')).not.toBeInTheDocument();
  });

  it('switches mobile profile sections with horizontal swipes', async () => {
    chatApiMock.getConversationAttachments
      .mockResolvedValueOnce({
        items: [
          {
            id: 'att-1',
            message_id: 'msg-1',
            kind: 'image',
            file_name: 'photo.png',
            mime_type: 'image/png',
            file_size: 1024,
            created_at: '2026-03-25T10:00:00Z',
          },
        ],
        has_more: false,
        next_before_attachment_id: null,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'att-2',
            message_id: 'msg-2',
            kind: 'file',
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
            file_size: 4096,
            created_at: '2026-03-25T11:00:00Z',
          },
        ],
        has_more: false,
        next_before_attachment_id: null,
      });

    renderWithTheme(buildProps({
      activeConversation: directConversation,
      conversationHeaderSubtitle: 'Был(а) недавно',
      mobileScreen: true,
      embedded: true,
    }));

    const content = await screen.findByTestId('chat-context-mobile-tab-content');

    fireEvent.touchStart(content, { changedTouches: [{ clientX: 240, clientY: 160 }] });
    fireEvent.touchEnd(content, { changedTouches: [{ clientX: 120, clientY: 168 }] });

    await waitFor(() => expect(chatApiMock.getConversationAttachments).toHaveBeenLastCalledWith('conv-2', {
      kind: 'file',
      limit: 12,
      before_attachment_id: undefined,
    }));
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('extracts links from chat messages and exposes them in the links section', async () => {
    chatApiMock.getConversationAssetsSummary.mockResolvedValueOnce({
      photos_count: 0,
      videos_count: 0,
      files_count: 0,
      audio_count: 0,
      shared_tasks_count: 0,
      recent_photos: [],
      recent_videos: [],
      recent_files: [],
      recent_audio: [],
    });

    renderWithTheme(buildProps({
      messages: [
        {
          id: 'msg-link-1',
          kind: 'text',
          body: 'Нужная ссылка https://example.com/docs/spec',
          created_at: '2026-03-25T13:00:00Z',
        },
      ],
    }));

    await waitFor(() => expect(chatApiMock.getConversationAssetsSummary).toHaveBeenCalledWith('conv-1'));
    fireEvent.click(screen.getByRole('button', { name: /Ссылки/i }));
    const link = await screen.findByRole('link', { name: /example\.com\/docs\/spec/i });
    expect(link).toHaveAttribute('href', 'https://example.com/docs/spec');
    expect(screen.getAllByText('Ссылки').length).toBeGreaterThan(0);
  });
});
