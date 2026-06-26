import {
  getTransferActReminderLabel,
  isTransferActUploadTask,
} from '../../lib/hubTaskIntegrations';
import TasksDetailWorkspace from '../../components/hub/tasks/TasksDetailWorkspace';
import { useTasksDetailSlice, useTasksFiltersSlice, useTasksUiSlice } from './TasksPageContext';

export default function TasksDetailPanel() {
  const ui = useTasksUiSlice();
  const detail = useTasksDetailSlice();
  const filters = useTasksFiltersSlice();

  return (
    <TasksDetailWorkspace
      task={detail.detailsTask}
      loading={detail.detailsLoading}
      isMobile={ui.isMobile}
      ui={ui.ui}
      theme={ui.theme}
      selectedMobileTaskView={detail.selectedMobileTaskView}
      selectedTaskTab={detail.selectedTaskTab}
      taskDiscussionChatEnabled={filters.taskDiscussionChatEnabled}
      discussionOpening={detail.discussionOpening}
      reopeningTaskId={detail.reopeningTaskId}
      comments={detail.detailsComments}
      statusLog={detail.detailsStatusLog}
      activityLoading={detail.detailsActivityLoading}
      commentBody={detail.detailsCommentBody}
      commentSaving={detail.detailsCommentSaving}
      uploadingAttachment={detail.uploadingAttachment}
      canEditTask={detail.canEditTask}
      canDeleteTask={detail.canDeleteTask}
      canUploadFiles={detail.canUploadFiles}
      canUpdateTaskChecklist={detail.canUpdateTaskChecklist}
      canOpenTransferActUpload={ui.canOpenTransferActUpload}
      canStartTask={detail.canStartTask}
      canSubmitTask={detail.canSubmitTask}
      canReviewTask={detail.canReviewTask}
      canReopenTask={detail.canReopenTask}
      getTransferActReminderLabel={getTransferActReminderLabel}
      isTransferActUploadTask={isTransferActUploadTask}
      formatDateTime={ui.formatDateTime}
      formatFileSize={ui.formatFileSize}
      getInitials={ui.getInitials}
      statusMeta={ui.statusMeta}
      priorityMeta={ui.priorityMeta}
      onBack={detail.closeTaskDetails}
      onBackFromChecklist={detail.closeMobileTaskChecklist}
      onCopyLink={() => void detail.handleCopyTaskLink(detail.detailsTask?.id, detail.selectedTaskTab)}
      onOpenEditTask={detail.openEditTask}
      onDeleteTask={(task) => void detail.handleDeleteTask(task)}
      onOpenTaskDiscussion={detail.handleOpenTaskDiscussion}
      onToggleChecklistItem={detail.handleToggleTaskChecklistItem}
      onAddChecklistItem={detail.handleAddTaskChecklistItem}
      onUploadAttachment={detail.handleUploadAttachment}
      onDownloadAttachment={detail.handleDownloadAttachment}
      onDownloadReport={detail.handleDownloadReport}
      onTabChange={detail.setTaskDetailTab}
      onCommentChange={detail.setDetailsCommentBody}
      onAddComment={() => void detail.handleAddTaskComment()}
      onOpenMobileChecklist={detail.openMobileTaskChecklist}
      onOpenTransferActReminder={detail.openTransferActReminder}
      onStartTask={detail.handleStartTask}
      onReopenTask={detail.handleOpenReopenTask}
      onOpenSubmitTask={detail.setSubmitTask}
      onOpenReviewTask={detail.setReviewTask}
      renderChecklist={detail.renderTaskChecklist}
    />
  );
}
