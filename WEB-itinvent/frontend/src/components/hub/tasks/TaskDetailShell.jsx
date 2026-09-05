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
  backLabel = 'К списку',
  onCopyLink,
  isMobile = false,
  compactHeader = false,
  contentMode = 'scroll',
  archiveComments = false,
  actionMenuItems = [],
  onActionMenuSelect,
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
        backLabel={backLabel}
        onCopyLink={onCopyLink}
        mobile={isMobile}
        compact={compactHeader}
        archiveComments={archiveComments}
        actionMenuItems={actionMenuItems}
        onActionMenuSelect={onActionMenuSelect}
        ui={ui}
        theme={theme}
      />
      <Box
        data-testid="task-detail-content"
        data-content-mode={contentMode}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: contentMode === 'fill' ? 'hidden' : 'auto',
          ...(contentMode === 'fill' ? { display: 'flex', flexDirection: 'column' } : {}),
        }}
      >
        {loading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
        {children}
      </Box>
    </Box>
  );
}
