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

  it('renders mobile checklist screen when selected view is checklist', () => {
    renderWorkspace({
      isMobile: true,
      selectedMobileTaskView: 'checklist',
    });

    expect(screen.getByTestId('task-mobile-checklist-screen')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-mobile-title')).toHaveTextContent('Чек-лист');
  });
});
