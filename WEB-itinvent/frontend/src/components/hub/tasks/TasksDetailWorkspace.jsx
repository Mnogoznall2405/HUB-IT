import { useMemo } from 'react';
import {
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import MarkdownRenderer from '../MarkdownRenderer';
import {
  TaskActivityTabs,
  TaskContextSidebar,
  TaskMobileChecklistScreen,
  TaskMobileDetailScreen,
  TaskPrimaryActions,
} from './detail';
import TaskDetailShell from './TaskDetailShell';
import TaskDetailChecklist from './TaskDetailChecklist';
import { getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import { hideMobileScrollbarSx } from '../../../pages/tasks/taskFormatters';
import { buildMobileTaskActionState } from '../../../pages/tasksViewModel';

function TaskDetailOverviewSections({
  task,
  ui,
  formatDateTime,
  onDownloadReport,
  renderChecklist,
}) {
  if (!task) return null;

  return (
    <>
      {String(task.review_comment || '').trim() && (
        <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
          <Typography sx={{ fontWeight: 800, mb: 0.45 }}>Комментарий проверки</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {task.review_comment}
          </Typography>
        </Box>
      )}

      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.3, borderRadius: '14px' }) }}>
        <Typography sx={{ fontWeight: 800, mb: 0.7 }}>Описание задачи</Typography>
        {String(task.description || '').trim() ? (
          <MarkdownRenderer value={task.description} />
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Описание задачи не заполнено.
          </Typography>
        )}
      </Box>

      {renderChecklist(task)}

      {task.latest_report && (
        <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography sx={{ fontWeight: 800 }}>Последний отчёт</Typography>
              <Typography variant="caption" sx={{ color: ui.subtleText }}>
                {formatDateTime(task.latest_report.uploaded_at)} · {task.latest_report.uploaded_by_username || '-'}
              </Typography>
            </Box>
            {task.latest_report.file_name && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => void onDownloadReport(task.latest_report)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
              >
                Скачать
              </Button>
            )}
          </Stack>
          {task.latest_report.comment && (
            <Typography variant="body2" sx={{ mt: 0.8, whiteSpace: 'pre-wrap' }}>
              {task.latest_report.comment}
            </Typography>
          )}
        </Box>
      )}
    </>
  );
}

export default function TasksDetailWorkspace({
  task,
  loading = false,
  isMobile = false,
  ui,
  theme,
  selectedMobileTaskView = 'detail',
  selectedTaskTab = 'comments',
  taskDiscussionChatEnabled = false,
  discussionOpening = false,
  reopeningTaskId = '',
  comments = [],
  statusLog = [],
  activityLoading = false,
  commentBody = '',
  commentSaving = false,
  uploadingAttachment = false,
  canEditTask,
  canDeleteTask,
  canUploadFiles,
  canUpdateTaskChecklist,
  canOpenTransferActUpload,
  canStartTask,
  canSubmitTask,
  canReviewTask,
  canReopenTask,
  getTransferActReminderLabel,
  isTransferActUploadTask,
  formatDateTime,
  formatFileSize,
  getInitials,
  statusMeta,
  priorityMeta,
  onBack,
  onBackFromChecklist,
  onCopyLink,
  onOpenEditTask,
  onDeleteTask,
  onOpenTaskDiscussion,
  onToggleChecklistItem,
  onAddChecklistItem,
  onUploadAttachment,
  onDownloadAttachment,
  onDownloadReport,
  onTabChange,
  onCommentChange,
  onAddComment,
  onOpenMobileChecklist,
  onOpenTransferActReminder,
  onStartTask,
  onReopenTask,
  onOpenSubmitTask,
  onOpenReviewTask,
  renderChecklist,
}) {
  const checklistRenderer = renderChecklist || ((taskItem) => (
    <TaskDetailChecklist
      task={taskItem}
      canUpdate={canUpdateTaskChecklist(taskItem)}
      onToggle={(itemId, done) => void onToggleChecklistItem(taskItem, itemId, done)}
      ui={ui}
    />
  ));

  const actionMenuItems = useMemo(() => {
    if (!task) return [];
    return [
      { key: 'copy', label: 'Копировать ссылку' },
      canEditTask(task) ? { key: 'edit', label: 'Редактировать' } : null,
      canDeleteTask(task) ? { key: 'delete', label: 'Удалить', tone: 'danger' } : null,
    ].filter(Boolean);
  }, [canDeleteTask, canEditTask, task]);

  const mobileActionState = useMemo(() => {
    if (!task) return null;
    return buildMobileTaskActionState(task, {
      canOpenTransferActUpload: canOpenTransferActUpload(task),
      canStart: canStartTask(task),
      canSubmit: canSubmitTask(task),
      canReview: canReviewTask(task),
      canReopen: canReopenTask(task),
    });
  }, [canOpenTransferActUpload, canReopenTask, canReviewTask, canStartTask, canSubmitTask, task]);

  const mobilePrimaryActions = task ? (
    <TaskPrimaryActions
      task={task}
      canOpenTransferActUpload={canOpenTransferActUpload(task)}
      canStartTask={canStartTask(task)}
      canSubmitTask={canSubmitTask(task)}
      canReviewTask={canReviewTask(task)}
      canReopenTask={canReopenTask(task)}
      reopening={reopeningTaskId === String(task.id)}
      canEditTask={canEditTask(task)}
      canDeleteTask={canDeleteTask(task)}
      compactMobile={isMobile}
      onOpenTransferActReminder={onOpenTransferActReminder}
      onStartTask={onStartTask}
      onReopenTask={onReopenTask}
      onOpenSubmitTask={onOpenSubmitTask}
      onOpenReviewTask={onOpenReviewTask}
      onOpenEditTask={onOpenEditTask}
      onDeleteTask={onDeleteTask}
      onCopyLink={onCopyLink}
      mobileRail={isMobile}
    />
  ) : null;

  const desktopSidebarActions = task ? (
    <TaskPrimaryActions
      task={task}
      canOpenTransferActUpload={canOpenTransferActUpload(task)}
      canStartTask={canStartTask(task)}
      canSubmitTask={canSubmitTask(task)}
      canReviewTask={canReviewTask(task)}
      canReopenTask={canReopenTask(task)}
      reopening={reopeningTaskId === String(task.id)}
      canEditTask={canEditTask(task)}
      canDeleteTask={canDeleteTask(task)}
      onOpenTransferActReminder={onOpenTransferActReminder}
      onStartTask={onStartTask}
      onReopenTask={onReopenTask}
      onOpenSubmitTask={onOpenSubmitTask}
      onOpenReviewTask={onOpenReviewTask}
      onOpenEditTask={onOpenEditTask}
      onDeleteTask={onDeleteTask}
      onCopyLink={onCopyLink}
    />
  ) : null;

  return (
    <TaskDetailShell
      task={task}
      ui={ui}
      theme={theme}
      statusMeta={statusMeta(task?.status)}
      priorityMeta={priorityMeta(task?.priority)}
      transferLabel={getTransferActReminderLabel(task)}
      isTransferReminder={isTransferActUploadTask(task)}
      mobileTitle={selectedMobileTaskView === 'checklist' ? 'Чек-лист' : 'Задача'}
      onBack={isMobile && selectedMobileTaskView === 'checklist' ? onBackFromChecklist : onBack}
      onCopyLink={onCopyLink}
      isMobile={isMobile}
      actionMenuItems={actionMenuItems}
      onActionMenuSelect={(key) => {
        if (key === 'edit') {
          onOpenEditTask(task);
          return;
        }
        if (key === 'delete') {
          void onDeleteTask(task);
          return;
        }
        if (key === 'copy') {
          void onCopyLink();
        }
      }}
      taskDiscussionEnabled={taskDiscussionChatEnabled}
      onOpenTaskDiscussion={() => void onOpenTaskDiscussion(task)}
      discussionOpening={discussionOpening}
      loading={loading}
    >
      <Box
        sx={{
          px: isMobile ? 0 : { xs: 1, md: 1.25 },
          py: isMobile ? 0 : 1.1,
          bgcolor: isMobile && theme.palette.mode === 'dark' ? '#0b0b0c' : undefined,
          ...(isMobile ? hideMobileScrollbarSx : {}),
        }}
      >
        {task ? (
          isMobile ? (
            selectedMobileTaskView === 'checklist' ? (
              <TaskMobileChecklistScreen
                task={task}
                canUpdate={canUpdateTaskChecklist(task)}
                onToggleItem={(itemId, done) => void onToggleChecklistItem(task, itemId, done)}
                onAddItem={(text) => void onAddChecklistItem(task, text)}
                ui={ui}
                theme={theme}
              />
            ) : (
              <TaskMobileDetailScreen
                task={task}
                attachments={Array.isArray(task.attachments) ? task.attachments : []}
                canUploadFiles={canUploadFiles(task)}
                uploadingAttachment={uploadingAttachment}
                onUploadAttachment={(file) => void onUploadAttachment(task.id, file)}
                onDownloadAttachment={(attachment) => void onDownloadAttachment(task, attachment)}
                onDownloadReport={(report) => void onDownloadReport(report)}
                onOpenChecklist={onOpenMobileChecklist}
                taskDiscussionEnabled={taskDiscussionChatEnabled}
                onOpenTaskDiscussion={() => void onOpenTaskDiscussion(task)}
                discussionOpening={discussionOpening}
                formatDateTime={formatDateTime}
                formatFileSize={formatFileSize}
                ui={ui}
                theme={theme}
                actions={mobilePrimaryActions}
              />
            )
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.35fr) minmax(300px, 360px)' },
                gap: 1.25,
                alignItems: 'start',
              }}
            >
              <Stack spacing={1.25} sx={{ minWidth: 0 }}>
                <TaskDetailOverviewSections
                  task={task}
                  ui={ui}
                  formatDateTime={formatDateTime}
                  onDownloadReport={onDownloadReport}
                  renderChecklist={checklistRenderer}
                />

                <TaskActivityTabs
                  activeTab={selectedTaskTab}
                  onTabChange={onTabChange}
                  comments={comments}
                  commentsCount={Number(task.comments_count) || comments.length}
                  attachments={Array.isArray(task.attachments) ? task.attachments : []}
                  statusLog={statusLog}
                  activityLoading={activityLoading}
                  commentBody={commentBody}
                  onCommentChange={onCommentChange}
                  onAddComment={onAddComment}
                  commentSaving={commentSaving}
                  canUploadFiles={canUploadFiles(task)}
                  onUploadAttachment={(file) => void onUploadAttachment(task.id, file)}
                  uploadingAttachment={uploadingAttachment}
                  onDownloadAttachment={(attachment) => void onDownloadAttachment(task, attachment)}
                  formatDateTime={formatDateTime}
                  formatFileSize={formatFileSize}
                  getInitials={getInitials}
                  statusMeta={statusMeta}
                  ui={ui}
                  theme={theme}
                  taskDiscussionEnabled={taskDiscussionChatEnabled}
                />
              </Stack>

              <TaskContextSidebar
                task={task}
                ui={ui}
                theme={theme}
                statusMeta={statusMeta(task?.status)}
                priorityMeta={priorityMeta(task?.priority)}
                transferLabel={getTransferActReminderLabel(task)}
                isTransferReminder={isTransferActUploadTask(task)}
                formatDateTime={formatDateTime}
                actionState={mobileActionState}
                actions={desktopSidebarActions}
              />
            </Box>
          )
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            {loading ? 'Загрузка карточки задачи...' : 'Карточка задачи недоступна.'}
          </Typography>
        )}
      </Box>
    </TaskDetailShell>
  );
}
