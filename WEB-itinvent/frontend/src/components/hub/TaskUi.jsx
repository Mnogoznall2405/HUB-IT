import {
  Avatar,
  Box,
  Button,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import MarkdownRenderer from './MarkdownRenderer';

export {
  TASK_DETAIL_TABS,
  getDefaultTaskDetailTab,
  normalizeTaskDetailTab,
} from '../../lib/taskNavigation';

export { TaskDetailHeader } from './tasks/detail/TaskDetailHeader.jsx';
export { TaskMobileDetailScreen } from './tasks/detail/TaskMobileDetailScreen.jsx';
export { TaskMobileChecklistScreen } from './tasks/detail/TaskMobileChecklistScreen.jsx';
export { TaskPrimaryActions } from './tasks/detail/TaskPrimaryActions.jsx';
export { TaskContextSidebar } from './tasks/detail/TaskContextSidebar.jsx';
export { TaskActivityTabs } from './tasks/detail/TaskActivityTabs.jsx';
export { TaskPreviewDrawer } from './tasks/detail/TaskPreviewDrawer.jsx';

export function TaskMobileContentSummary({
  task,
  attachments = [],
  canUploadFiles = false,
  uploadingAttachment = false,
  onUploadAttachment,
  onDownloadAttachment,
  onDownloadReport,
  formatDateTime,
  formatFileSize,
  ui,
  theme,
}) {
  const description = String(task?.description || '').trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const report = task?.latest_report?.file_name
    ? {
      id: `report-${task.latest_report.id || task.latest_report.file_name}`,
      type: 'report',
      file_name: task.latest_report.file_name,
      uploaded_at: task.latest_report.uploaded_at,
      uploaded_by_username: task.latest_report.uploaded_by_username,
      payload: task.latest_report,
    }
    : null;
  const fileItems = [
    ...normalizedAttachments.map((attachment) => ({
      id: `attachment-${attachment.id || attachment.file_name}`,
      type: 'attachment',
      file_name: attachment.file_name || 'file',
      file_size: attachment.file_size,
      uploaded_at: attachment.uploaded_at,
      payload: attachment,
    })),
    ...(report ? [report] : []),
  ];
  const visibleFiles = fileItems.slice(0, 3);
  const hiddenFilesCount = Math.max(fileItems.length - visibleFiles.length, 0);
  const hasFiles = fileItems.length > 0;
  const handleUploadChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onUploadAttachment?.(file);
    event.target.value = '';
  };

  return (
    <Stack spacing={1} data-testid="task-mobile-content">
      <Box
        sx={{
          p: 1.15,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 950, fontSize: '1.12rem', lineHeight: 1.22 }}>
          {task?.title || 'Карточка задачи'}
        </Typography>
      </Box>

      <Box
        data-testid="task-mobile-description"
        sx={{
          p: 1.15,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 850, mb: 0.65 }}>Описание</Typography>
        {description ? (
          <MarkdownRenderer value={description} />
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Описание задачи не заполнено.
          </Typography>
        )}
      </Box>

      {(hasFiles || canUploadFiles) && (
        <Box
          data-testid="task-mobile-files"
          sx={{
            p: 1.05,
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
          }}
        >
          <Stack spacing={0.85}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Typography sx={{ fontWeight: 850 }}>Файлы</Typography>
              {hiddenFilesCount > 0 && (
                <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>
                  ещё {hiddenFilesCount}
                </Typography>
              )}
            </Stack>

            {hasFiles ? (
              <Stack spacing={0.55}>
                {visibleFiles.map((file) => (
                  <Stack
                    key={file.id}
                    data-testid={`task-mobile-file-${file.id}`}
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    sx={{
                      minWidth: 0,
                      p: 0.65,
                      borderRadius: '10px',
                      bgcolor: ui.actionBg,
                    }}
                  >
                    <Avatar sx={{ width: 30, height: 30, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                      <AttachFileIcon sx={{ fontSize: 16 }} />
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.file_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>
                        {file.type === 'report' ? 'Отчёт' : formatFileSize?.(file.file_size)} · {formatDateTime?.(file.uploaded_at)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      aria-label={`Скачать ${file.file_name}`}
                      onClick={() => {
                        if (file.type === 'report') {
                          onDownloadReport?.(file.payload);
                          return;
                        }
                        onDownloadAttachment?.(file.payload);
                      }}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                Файлов пока нет.
              </Typography>
            )}

            {canUploadFiles && (
              <Button
                size="small"
                variant={hasFiles ? 'text' : 'outlined'}
                component="label"
                startIcon={<AttachFileIcon />}
                disabled={uploadingAttachment}
                sx={{ alignSelf: hasFiles ? 'flex-start' : 'stretch', textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
              >
                {uploadingAttachment ? 'Загрузка...' : 'Прикрепить файл'}
                <input type="file" hidden onChange={handleUploadChange} />
              </Button>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
