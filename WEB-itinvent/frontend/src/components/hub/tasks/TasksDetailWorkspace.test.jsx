import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksDetailWorkspace from './TasksDetailWorkspace';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import {
  formatDateTime,
  formatFileSize,
  getInitials,
  priorityMeta,
  statusMeta,
} from '../../../pages/tasks/taskFormatters';

vi.mock('./TaskCanvasWorkspace', () => ({
  default: () => <div data-testid="task-canvas-stub">canvas</div>,
}));
vi.mock('./TaskDiscussionWorkspace', () => ({
  default: ({ conversationId, messageId }) => (
    <div data-testid="task-discussion-stub" data-conversation-id={conversationId} data-message-id={messageId}>
      discussion
    </div>
  ),
}));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const baseTask = {
  id: 'task-1',
  title: 'Проверить отчёт',
  description: 'Нужно сверить цифры',
  status: 'in_progress',
  priority: 'high',
  review_comment: '',
  comments_count: 0,
  attachments: [],
  checklist_items: [{ id: 'c1', text: 'Пункт 1', done: false }],
  checklist_total: 1,
  checklist_done: 0,
  capabilities: {},
};

const noop = () => {};
const alwaysFalse = () => false;
const alwaysTrue = () => true;

const renderWorkspace = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <TasksDetailWorkspace
      task={baseTask}
      loading={false}
      isMobile={false}
      ui={ui}
      theme={theme}
      selectedMobileTaskView="detail"
      selectedTaskTab="comments"
      selectedTaskView="overview"
      comments={[]}
      statusLog={[]}
      canEditTask={alwaysTrue}
      canDeleteTask={alwaysFalse}
      canUploadFiles={alwaysTrue}
      canUpdateTaskChecklist={alwaysTrue}
      canOpenTransferActUpload={alwaysFalse}
      canStartTask={alwaysFalse}
      canSubmitTask={alwaysTrue}
      canReviewTask={alwaysFalse}
      canCloseTask={alwaysFalse}
      canReopenTask={alwaysFalse}
      getTransferActReminderLabel={() => ''}
      isTransferActUploadTask={alwaysFalse}
      formatDateTime={formatDateTime}
      formatFileSize={formatFileSize}
      getInitials={getInitials}
      statusMeta={statusMeta}
      priorityMeta={priorityMeta}
      onBack={noop}
      onBackFromChecklist={noop}
      onCopyLink={noop}
      onOpenEditTask={noop}
      onDeleteTask={noop}
      onOpenTaskDiscussion={noop}
      onToggleChecklistItem={noop}
      onAddChecklistItem={noop}
      onUploadAttachment={noop}
      onDownloadAttachment={noop}
      onDownloadReport={noop}
      onTabChange={noop}
      onViewChange={noop}
      onCommentChange={noop}
      onAddComment={noop}
      onOpenMobileChecklist={noop}
      onOpenTransferActReminder={noop}
      onStartTask={noop}
      onReopenTask={noop}
      onOpenSubmitTask={noop}
      onOpenReviewTask={noop}
      renderChecklist={() => <div data-testid="task-checklist-stub">checklist</div>}
      {...props}
    />
  </ThemeProvider>,
);

describe('TasksDetailWorkspace', () => {
  it('renders desktop task description and checklist section', () => {
    renderWorkspace();
    expect(screen.getByText('Проверить отчёт')).toBeInTheDocument();
    expect(screen.getByText('Описание задачи')).toBeInTheDocument();
    expect(screen.getByText('Нужно сверить цифры')).toBeInTheDocument();
    expect(screen.getByTestId('task-checklist-stub')).toBeInTheDocument();
  });

  it('switches from the overview to the task canvas mode', () => {
    const onViewChange = vi.fn();
    renderWorkspace({ onViewChange });

    fireEvent.click(screen.getByRole('tab', { name: 'Доска' }));

    expect(onViewChange).toHaveBeenCalledWith('canvas');
  });

  it('uses the compact viewport-filling layout in canvas mode', async () => {
    renderWorkspace({ selectedTaskView: 'canvas' });

    expect(await screen.findByTestId('task-canvas-stub')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-compact-header')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-content')).toHaveAttribute('data-content-mode', 'fill');
    expect(getComputedStyle(screen.getByTestId('task-detail-workspace-content')).overflow).toBe('hidden');
    expect(screen.queryByText('Полная карточка задачи с обсуждением, файлами и историей статусов.')).not.toBeInTheDocument();
  });

  it('renders the existing chat surface inside the discussion tab', async () => {
    renderWorkspace({
      selectedTaskView: 'discussion',
      taskDiscussionChatEnabled: true,
      discussionConversationId: 'conversation-task-1',
      discussionMessageId: 'message-4',
    });

    const discussion = await screen.findByTestId('task-discussion-stub');
    expect(discussion).toHaveAttribute('data-conversation-id', 'conversation-task-1');
    expect(discussion).toHaveAttribute('data-message-id', 'message-4');
    expect(screen.getByTestId('task-detail-content')).toHaveAttribute('data-content-mode', 'fill');
    expect(screen.queryByTestId('task-detail-open-chat')).not.toBeInTheDocument();
  });

  it('hides the discussion tab when the task capability disables it', () => {
    renderWorkspace({
      task: {
        ...baseTask,
        capabilities: { can_open_discussion: false },
      },
      taskDiscussionChatEnabled: true,
    });

    expect(screen.queryByRole('tab', { name: 'Обсуждение' })).not.toBeInTheDocument();
  });

  it('renders mobile detail screen and forwards checklist open', () => {
    const onOpenMobileChecklist = vi.fn();
    renderWorkspace({
      isMobile: true,
      onOpenMobileChecklist,
    });

    expect(screen.getByTestId('task-mobile-detail-screen')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('task-mobile-checklist-summary'));
    expect(onOpenMobileChecklist).toHaveBeenCalled();
  });

  it('offers task attachment preview on mobile', () => {
    renderWorkspace({
      isMobile: true,
      task: {
        ...baseTask,
        attachments: [{
          id: 'attachment-1',
          file_name: 'manual.pdf',
          file_mime: 'application/pdf',
          file_size: 1024,
        }],
      },
    });

    expect(screen.getByRole('button', { name: 'Предпросмотр manual.pdf' })).toBeInTheDocument();
  });

  it('renders mobile checklist screen when selected view is checklist', () => {
    renderWorkspace({
      isMobile: true,
      selectedMobileTaskView: 'checklist',
    });

    expect(screen.getByTestId('task-mobile-checklist-screen')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-mobile-title')).toHaveTextContent('Чек-лист');
  });

  it('offers Android share in the task action menu when the native callback is available', () => {
    const onShareLink = vi.fn();
    renderWorkspace({
      isMobile: true,
      onShareLink,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Действия задачи' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Поделиться' }));
    expect(onShareLink).toHaveBeenCalledTimes(1);
  });
});
