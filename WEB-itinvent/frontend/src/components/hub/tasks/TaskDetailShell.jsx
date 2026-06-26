import { Box, LinearProgress } from '@mui/material';
import { TaskDetailHeader } from './detail/TaskDetailHeader';

export default function TaskDetailShell({
  task,
  ui,
  theme,
  statusMeta,
  priorityMeta,
  transferLabel = '',
  isTransferReminder = false,
  mobileTitle = 'Задача',
  onBack,
  onCopyLink,
  isMobile = false,
  actionMenuItems = [],
  onActionMenuSelect,
  taskDiscussionEnabled = false,
  onOpenTaskDiscussion,
  discussionOpening = false,
  loading = false,
  children,
}) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <TaskDetailHeader
        task={task}
        statusMeta={statusMeta}
        priorityMeta={priorityMeta}
        transferLabel={transferLabel}
        isTransferReminder={isTransferReminder}
        mobileTitle={mobileTitle}
        onBack={onBack}
        onCopyLink={onCopyLink}
        mobile={isMobile}
        actionMenuItems={actionMenuItems}
        onActionMenuSelect={onActionMenuSelect}
        taskDiscussionEnabled={taskDiscussionEnabled}
        onOpenTaskDiscussion={onOpenTaskDiscussion}
        discussionOpening={discussionOpening}
        ui={ui}
        theme={theme}
      />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
        {children}
      </Box>
    </Box>
  );
}
