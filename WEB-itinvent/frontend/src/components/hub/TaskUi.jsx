import { useEffect, useRef } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FlagIcon from '@mui/icons-material/Flag';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MarkdownRenderer from './MarkdownRenderer';
import OverflowMenu from '../common/OverflowMenu';

export const TASK_DETAIL_TABS = ['comments', 'files', 'history'];

export const normalizeTaskDetailTab = (value) => (
  TASK_DETAIL_TABS.includes(String(value || '').trim().toLowerCase())
    ? String(value || '').trim().toLowerCase()
    : 'comments'
);

const clampTextSx = (lines) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

const renderKvRows = (rows, ui) => (
  <Stack spacing={1}>
    {rows.map((row) => (
      <Box key={row.label}>
        <Typography variant="caption" sx={{ color: ui.subtleText }}>
          {row.label}
        </Typography>
        <Typography sx={{ fontWeight: 700 }}>
          {row.value || '-'}
        </Typography>
      </Box>
    ))}
  </Stack>
);

export function TaskDetailHeader({
  task,
  statusMeta,
  priorityMeta,
  transferLabel,
  isTransferReminder,
  onBack,
  onCopyLink,
  mobile = false,
  actionMenuItems = [],
  onActionMenuSelect,
  ui,
  theme,
}) {
  const priority = priorityMeta;
  const chips = (
    <Stack direction="row" spacing={0.55} sx={{ flexWrap: 'wrap', gap: 0.55 }}>
      <Chip
        size="small"
        label={statusMeta.label}
        sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }}
      />
      {priority?.value !== 'normal' && (
        <Chip
          size="small"
          icon={<FlagIcon sx={{ fontSize: '12px !important', color: `${priority.dotColor} !important` }} />}
          label={priority.label}
          sx={{
            fontWeight: 800,
            bgcolor: alpha(priority.dotColor, 0.12),
            color: priority.dotColor,
            '& .MuiChip-icon': { ml: '2px' },
          }}
        />
      )}
      {isTransferReminder && (
        <Chip
          size="small"
          label={transferLabel}
          sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
        />
      )}
      {task?.is_overdue && (
        <Chip
          size="small"
          label="Просрочено"
          sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }}
        />
      )}
      {task?.has_unread_comments && (
        <Chip
          size="small"
          label="Новый комментарий"
          sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
        />
      )}
      {Number(task?.comments_count || 0) > 0 && (
        <Chip size="small" label={`Комментарии: ${task.comments_count}`} sx={{ fontWeight: 700 }} />
      )}
      {Number(task?.attachments_count || 0) > 0 && (
        <Chip size="small" label={`Файлы: ${task.attachments_count}`} sx={{ fontWeight: 700 }} />
      )}
    </Stack>
  );

  if (mobile) {
    return (
      <Box
        data-testid="task-detail-mobile-header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          px: 1,
          py: 0.95,
          borderBottom: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: alpha(ui.pageBg, 0.98),
          backdropFilter: 'blur(10px)',
        }}
      >
        <Stack spacing={0.9}>
          <Stack direction="row" spacing={0.8} alignItems="flex-start" justifyContent="space-between">
            <Button
              variant="text"
              startIcon={<ArrowBackIcon />}
              onClick={onBack}
              sx={{ textTransform: 'none', fontWeight: 800, minWidth: 0, px: 0.5 }}
            >
              Назад
            </Button>
            {Array.isArray(actionMenuItems) && actionMenuItems.length > 0 ? (
              <Box data-testid="task-detail-mobile-actions">
                <OverflowMenu
                  label="Действия задачи"
                  size="medium"
                  items={actionMenuItems}
                  onSelect={onActionMenuSelect}
                />
              </Box>
            ) : null}
          </Stack>

          <Typography sx={{ fontWeight: 900, fontSize: '1rem', lineHeight: 1.22 }}>
            {task?.title || 'Карточка задачи'}
          </Typography>

          {chips}
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        px: { xs: 1.2, md: 1.5 },
        py: 1.25,
        borderBottom: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: alpha(ui.pageBg, 0.96),
        backdropFilter: 'blur(10px)',
      }}
    >
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={onBack}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', flexShrink: 0 }}
            >
              Назад к доске
            </Button>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, fontSize: { xs: '1.05rem', md: '1.3rem' }, lineHeight: 1.18 }}>
                {task?.title || 'Карточка задачи'}
              </Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.25 }}>
                Полная карточка задачи с обсуждением, файлами и историей статусов.
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={0.8} alignItems="center">
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={onCopyLink}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
            >
              Копировать ссылку
            </Button>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.55} sx={{ flexWrap: 'wrap', gap: 0.55 }}>
          <Chip
            size="small"
            label={statusMeta.label}
            sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }}
          />
          {priority?.value !== 'normal' && (
            <Chip
              size="small"
              icon={<FlagIcon sx={{ fontSize: '12px !important', color: `${priority.dotColor} !important` }} />}
              label={priority.label}
              sx={{
                fontWeight: 800,
                bgcolor: alpha(priority.dotColor, 0.12),
                color: priority.dotColor,
                '& .MuiChip-icon': { ml: '2px' },
              }}
            />
          )}
          {isTransferReminder && (
            <Chip
              size="small"
              label={transferLabel}
              sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
            />
          )}
          {task?.is_overdue && (
            <Chip
              size="small"
              label="Просрочено"
              sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }}
            />
          )}
          {task?.has_unread_comments && (
            <Chip
              size="small"
              label="Новый комментарий"
              sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
            />
          )}
          {Number(task?.comments_count || 0) > 0 && (
            <Chip size="small" label={`Комментарии: ${task.comments_count}`} sx={{ fontWeight: 700 }} />
          )}
          {Number(task?.attachments_count || 0) > 0 && (
            <Chip size="small" label={`Файлы: ${task.attachments_count}`} sx={{ fontWeight: 700 }} />
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

export function TaskPrimaryActions({
  task,
  canOpenTransferActUpload,
  canStartTask,
  canSubmitTask,
  canReviewTask,
  canEditTask,
  canDeleteTask,
  onOpenTransferActReminder,
  onStartTask,
  onOpenSubmitTask,
  onOpenReviewTask,
  onOpenEditTask,
  onDeleteTask,
  onCopyLink,
  compactMobile = false,
}) {
  const showSecondaryActions = !compactMobile && (canEditTask || canDeleteTask || onCopyLink);

  return (
    <Stack spacing={0.8}>
      {canOpenTransferActUpload && (
        <Button
          fullWidth
          variant="contained"
          onClick={() => onOpenTransferActReminder(task)}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
        >
          Загрузить подписанный акт
        </Button>
      )}
      {canStartTask && (
        <Button
          fullWidth
          variant="outlined"
          onClick={() => onStartTask(task.id)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          В работу
        </Button>
      )}
      {canSubmitTask && (
        <Button
          fullWidth
          variant="contained"
          onClick={() => onOpenSubmitTask(task)}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
        >
          Сдать работу
        </Button>
      )}
      {canReviewTask && (
        <Button
          fullWidth
          variant="contained"
          color="secondary"
          onClick={() => onOpenReviewTask(task)}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
        >
          Проверить
        </Button>
      )}

      {showSecondaryActions && <Divider />}

      {!compactMobile && canEditTask && (
        <Button
          fullWidth
          variant="outlined"
          onClick={() => onOpenEditTask(task)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          Редактировать
        </Button>
      )}
      {!compactMobile && canDeleteTask && (
        <Button
          fullWidth
          color="error"
          variant="outlined"
          onClick={() => onDeleteTask(task)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          Удалить
        </Button>
      )}
      {!compactMobile && onCopyLink && (
        <Button
          fullWidth
          variant="text"
          startIcon={<ContentCopyIcon />}
          onClick={onCopyLink}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          Копировать ссылку
        </Button>
      )}
    </Stack>
  );
}

export function TaskContextSidebar({
  task,
  ui,
  theme,
  statusMeta,
  priorityMeta,
  transferLabel,
  isTransferReminder,
  formatDateTime,
  actions,
  mobile = false,
}) {
  const summaryRows = [
    { label: 'Постановщик', value: task?.created_by_full_name || task?.created_by_username || '-' },
    { label: 'Исполнитель', value: task?.assignee_full_name || task?.assignee_username || '-' },
    { label: 'Контролёр', value: task?.controller_full_name || task?.controller_username || '-' },
    { label: 'Проверивший', value: task?.reviewer_full_name || '-' },
    { label: 'Проект', value: task?.project_name || 'Без проекта' },
    { label: 'Объект', value: task?.object_name || 'Без объекта' },
  ];
  const timelineRows = [
    { label: 'Дата протокола', value: task?.protocol_date ? formatDateTime(task.protocol_date) : '-' },
    { label: 'Срок', value: task?.due_at ? formatDateTime(task.due_at) : 'Без срока' },
    { label: 'Создано', value: formatDateTime(task?.created_at) },
    { label: 'Обновлено', value: formatDateTime(task?.updated_at || task?.created_at) },
    { label: 'Сдано', value: formatDateTime(task?.submitted_at) },
    { label: 'Проверено', value: formatDateTime(task?.reviewed_at) },
    { label: 'Завершено', value: formatDateTime(task?.completed_at) },
  ];

  if (mobile) {
    return (
      <Stack spacing={1} sx={{ alignSelf: 'stretch' }}>
        <Box
          sx={{
            p: 1.05,
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
          }}
        >
          <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Действия</Typography>
          {actions}
        </Box>

        <Accordion
          defaultExpanded={false}
          disableGutters
          data-testid="task-context-mobile-context"
          sx={{
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 800 }}>Контекст задачи</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }} />
              {priorityMeta?.value !== 'normal' && (
                <Chip
                  size="small"
                  label={priorityMeta.label}
                  sx={{ fontWeight: 800, bgcolor: alpha(priorityMeta.dotColor, 0.12), color: priorityMeta.dotColor }}
                />
              )}
              {isTransferReminder && (
                <Chip size="small" label={transferLabel} sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />
              )}
            </Stack>
            {renderKvRows(summaryRows, ui)}
          </AccordionDetails>
        </Accordion>

        <Accordion
          defaultExpanded={false}
          disableGutters
          data-testid="task-context-mobile-timeline"
          sx={{
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 800 }}>Сроки и состояние</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            {renderKvRows(timelineRows, ui)}
          </AccordionDetails>
        </Accordion>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.1} sx={{ position: { lg: 'sticky' }, top: { lg: 16 }, alignSelf: 'start' }}>
      <Box
        sx={{
          p: 1.2,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Действия</Typography>
        {actions}
      </Box>

      <Box
        sx={{
          p: 1.2,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Контекст задачи</Typography>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }} />
          {priorityMeta?.value !== 'normal' && (
            <Chip
              size="small"
              label={priorityMeta.label}
              sx={{ fontWeight: 800, bgcolor: alpha(priorityMeta.dotColor, 0.12), color: priorityMeta.dotColor }}
            />
          )}
        </Stack>
        {renderKvRows(summaryRows, ui)}
      </Box>

      <Box
        sx={{
          p: 1.2,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Сроки и состояние</Typography>
        {renderKvRows(timelineRows, ui)}
      </Box>

      {isTransferReminder && (
        <Box
          sx={{
            p: 1.2,
            borderRadius: '14px',
            border: '1px solid',
            borderColor: alpha('#2563eb', 0.18),
            bgcolor: 'rgba(37,99,235,0.06)',
            boxShadow: ui.shellShadow,
          }}
        >
          <Typography sx={{ fontWeight: 800, color: '#2563eb', mb: 0.45 }}>
            Напоминание по акту
          </Typography>
          <Typography variant="body2" sx={{ color: ui.mutedText, mb: 0.7 }}>
            Задача живёт до загрузки всех подписанных актов и закрывается автоматически после последнего commit.
          </Typography>
          <Chip
            size="small"
            label={transferLabel}
            sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
          />
        </Box>
      )}
    </Stack>
  );
}

export function TaskActivityTabs({
  activeTab,
  onTabChange,
  comments,
  attachments,
  statusLog,
  commentBody,
  onCommentChange,
  onAddComment,
  commentSaving,
  canUploadFiles,
  onUploadAttachment,
  uploadingAttachment,
  onDownloadAttachment,
  formatDateTime,
  formatFileSize,
  getInitials,
  statusMeta,
  ui,
  theme,
  mobile = false,
}) {
  const commentsRef = useRef(null);

  useEffect(() => {
    if (activeTab !== 'comments' || !commentsRef.current) return;
    commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
  }, [activeTab, comments]);

  return (
    <Box
      sx={{
        borderRadius: '16px',
        border: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: ui.panelSolid,
        boxShadow: ui.shellShadow,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.2, pt: 1.05, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        <Tabs
          value={activeTab}
          onChange={(_, value) => onTabChange(value)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{
            minHeight: 40,
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, minHeight: 40, fontSize: '0.84rem' },
            '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
          }}
        >
          <Tab value="comments" label={`Комментарии (${comments.length})`} />
          <Tab value="files" label={`Файлы (${attachments.length})`} />
          <Tab value="history" label={`История (${statusLog.length})`} />
        </Tabs>
      </Box>

      <Box sx={{ px: 1.2, py: 1.2 }}>
        {activeTab === 'comments' && (
          <Stack spacing={1}>
            <Box ref={commentsRef} sx={{ maxHeight: mobile ? 'none' : 380, overflowY: mobile ? 'visible' : 'auto', pr: 0.4 }}>
              {comments.length === 0 ? (
                <Typography variant="body2" sx={{ color: ui.mutedText }}>
                  Комментариев пока нет.
                </Typography>
              ) : (
                <List disablePadding dense>
                  {comments.map((item) => (
                    <ListItem key={item.id} disableGutters sx={{ alignItems: 'flex-start', py: 0.65 }}>
                      <ListItemAvatar sx={{ minWidth: 38 }}>
                        <Avatar
                          sx={{
                            width: 28,
                            height: 28,
                            bgcolor: alpha(theme.palette.primary.main, 0.14),
                            color: theme.palette.primary.main,
                            fontSize: '0.68rem',
                          }}
                        >
                          {getInitials(item.full_name || item.username)}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={item.full_name || item.username || '-'}
                        secondary={(
                          <>
                            <Typography component="span" variant="caption" sx={{ display: 'block', color: ui.subtleText, mb: 0.25 }}>
                              {formatDateTime(item.created_at)}
                            </Typography>
                            <Typography component="span" variant="body2" sx={{ color: 'text.primary', whiteSpace: 'pre-wrap' }}>
                              {item.body || ''}
                            </Typography>
                          </>
                        )}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>

            <Divider />

            <Stack spacing={0.8}>
              <TextField
                label="Новый комментарий"
                value={commentBody}
                onChange={(event) => onCommentChange(event.target.value)}
                multiline
                minRows={3}
                fullWidth
              />
              <Stack direction="row" justifyContent="flex-end">
                <Button
                  variant="contained"
                  onClick={() => onAddComment()}
                  disabled={commentSaving || String(commentBody || '').trim().length === 0}
                  sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none', width: { xs: '100%', sm: 'auto' } }}
                >
                  {commentSaving ? 'Сохранение...' : 'Добавить комментарий'}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        )}

        {activeTab === 'files' && (
          <Stack spacing={1}>
            {attachments.length === 0 ? (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                Вложений пока нет.
              </Typography>
            ) : (
              <List disablePadding dense>
                {attachments.map((attachment) => (
                  <ListItem
                    key={attachment.id}
                    disableGutters
                    secondaryAction={(
                      <IconButton size="small" onClick={() => onDownloadAttachment(attachment)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    )}
                  >
                    <ListItemAvatar sx={{ minWidth: 38 }}>
                      <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                        <AttachFileIcon sx={{ fontSize: 15 }} />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={attachment.file_name || 'file'}
                      secondary={`${formatFileSize(attachment.file_size)} · ${formatDateTime(attachment.uploaded_at)}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}

            {canUploadFiles && (
              <Button
                size="small"
                variant="outlined"
                component="label"
                startIcon={<AttachFileIcon />}
                disabled={uploadingAttachment}
                sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px', width: { xs: '100%', sm: 'auto' } }}
              >
                {uploadingAttachment ? 'Загрузка...' : 'Прикрепить файл'}
                <input
                  type="file"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUploadAttachment(file);
                    event.target.value = '';
                  }}
                />
              </Button>
            )}
          </Stack>
        )}

        {activeTab === 'history' && (
          <Stack spacing={0.95}>
            {statusLog.length === 0 ? (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                Переходы статусов пока не зафиксированы.
              </Typography>
            ) : (
              statusLog.map((item, index) => (
                <Stack key={item.id || `${item.changed_at}-${index}`} direction="row" spacing={1}>
                  <Box sx={{ width: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '999px', bgcolor: statusMeta(item.new_status).color, mt: 0.4 }} />
                    {index < statusLog.length - 1 && (
                      <Box sx={{ width: 2, flex: 1, bgcolor: ui.borderSoft, minHeight: 18, borderRadius: '999px' }} />
                    )}
                  </Box>
                  <Box sx={{ flex: 1, pb: 0.4 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
                      {`${item.old_status ? statusMeta(item.old_status).label : 'Создано'} -> ${statusMeta(item.new_status).label}`}
                    </Typography>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>
                      {item.changed_by_username || '-'} · {formatDateTime(item.changed_at)}
                    </Typography>
                  </Box>
                </Stack>
              ))
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

export function TaskPreviewDrawer({
  open,
  onClose,
  loading,
  task,
  mobile = false,
  ui,
  theme,
  paperSx,
  statusMeta,
  priorityMeta,
  transferLabel,
  isTransferReminder,
  canOpenTransferActUpload,
  onOpenTransferActReminder,
  onOpenInTasks,
  onDownloadReport,
  formatDateTime,
  latestCommentPreview,
}) {
  const priority = priorityMeta;
  const latestReportComment = String(task?.latest_report?.comment || '').trim();
  const descriptionPreview = String(task?.description || '').trim();
  const nextStepText = canOpenTransferActUpload
    ? 'Загрузите подписанный акт, чтобы закрыть напоминание и убрать задачу из очереди.'
    : task?.status === 'review'
      ? 'Откройте полную карточку, чтобы проверить результат, комментарии и историю статусов.'
      : task?.status === 'new'
        ? 'Откройте полную карточку и возьмите задачу в работу, если готовы её принять.'
        : task?.status === 'in_progress'
          ? 'Продолжите работу в полной карточке: там доступны обсуждение, файлы и история.'
          : 'Откройте полную карточку, чтобы посмотреть полный контекст и зафиксированный результат.';

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: mobile ? '100%' : { xs: '100%', sm: 460, lg: 520 },
          maxWidth: '100%',
          borderLeft: mobile ? 'none' : '1px solid',
          borderRadius: mobile ? 0 : undefined,
          display: 'flex',
          flexDirection: 'column',
          ...paperSx,
        },
      }}
    >
      <Box data-testid={mobile ? 'task-preview-mobile-header' : undefined} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        {mobile ? (
          <Stack spacing={0.9}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <IconButton onClick={onClose} size="small" sx={{ mt: -0.2, ml: -0.35 }} aria-label="Назад к центру управления">
                <ArrowBackIcon fontSize="small" />
              </IconButton>
              <Box data-testid="task-preview-mobile-actions">
                {task?.id ? (
                  <OverflowMenu
                    items={[{ key: 'open', label: 'Открыть в задачах', icon: <OpenInNewIcon fontSize="small" /> }]}
                    onSelect={(key) => {
                      if (key === 'open') onOpenInTasks?.();
                    }}
                    label="Действия задачи"
                  />
                ) : null}
              </Box>
            </Stack>
            <Typography sx={{ fontWeight: 900, fontSize: '1.02rem', lineHeight: 1.22 }}>
              {task?.title || 'Быстрый просмотр задачи'}
            </Typography>
          </Stack>
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.2 }}>
                {task?.title || 'Быстрый просмотр задачи'}
              </Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.3, ...clampTextSx(6) }}>
                Ключевые детали и следующее действие без полного перехода в рабочую карточку.
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.8}>
              {task?.id && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<OpenInNewIcon />}
                  onClick={onOpenInTasks}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
                >
                  Открыть в задачах
                </Button>
              )}
              <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700 }}>
                Закрыть
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5 }}>
        {loading ? (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Загрузка карточки задачи...
          </Typography>
        ) : task ? (
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={0.55} sx={{ flexWrap: 'wrap', gap: 0.55 }}>
              <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }} />
              {priority?.value !== 'normal' && (
                <Chip
                  size="small"
                  label={priority.label}
                  sx={{ fontWeight: 800, bgcolor: alpha(priority.dotColor, 0.12), color: priority.dotColor }}
                />
              )}
              {isTransferReminder && (
                <Chip size="small" label={transferLabel} sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />
              )}
              {task?.is_overdue && (
                <Chip size="small" label="Просрочено" sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }} />
              )}
              {task?.has_unread_comments && (
                <Chip size="small" label="Новый комментарий" sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />
              )}
              {Number(task?.comments_count || 0) > 0 && (
                <Chip size="small" label={`Комментарии: ${task.comments_count}`} sx={{ fontWeight: 700 }} />
              )}
              {Number(task?.attachments_count || 0) > 0 && (
                <Chip size="small" label={`Файлы: ${task.attachments_count}`} sx={{ fontWeight: 700 }} />
              )}
            </Stack>

            <Box sx={{ p: 1.2, borderRadius: '14px', border: '1px solid', borderColor: alpha('#2563eb', 0.14), bgcolor: isTransferReminder ? 'rgba(37,99,235,0.06)' : ui.panelSolid }}>
              <Typography sx={{ fontWeight: 800, mb: 0.35, color: isTransferReminder ? '#2563eb' : 'text.primary' }}>
                Что делать сейчас
              </Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mb: canOpenTransferActUpload ? 0.9 : 0 }}>
                {nextStepText}
              </Typography>
              {canOpenTransferActUpload && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => onOpenTransferActReminder(task)}
                  sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                >
                  Загрузить подписанный акт
                </Button>
              )}
            </Box>

            <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
              <Typography sx={{ fontWeight: 800, mb: 0.75 }}>Контекст</Typography>
              <Grid container spacing={1}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Исполнитель</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{task?.assignee_full_name || task?.assignee_username || '-'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Контролёр</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{task?.controller_full_name || task?.controller_username || '-'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Срок</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{task?.due_at ? formatDateTime(task.due_at) : 'Без срока'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Обновлено</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{formatDateTime(task?.updated_at || task?.created_at)}</Typography>
                </Grid>
              </Grid>
            </Box>

            {descriptionPreview && (
              <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
                <Typography sx={{ fontWeight: 800, mb: 0.45 }}>Описание</Typography>
                <MarkdownRenderer value={descriptionPreview} />
              </Box>
            )}

            {task?.latest_report && (
              <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
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
                      onClick={() => onDownloadReport(task.latest_report)}
                      sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
                    >
                      Скачать
                    </Button>
                  )}
                </Stack>
                {latestReportComment && (
                  <Box sx={{ mt: 0.7 }}>
                    <MarkdownRenderer value={latestReportComment} />
                  </Box>
                )}
              </Box>
            )}

            {latestCommentPreview && (
              <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
                <Stack direction="row" spacing={0.8} alignItems="flex-start">
                  <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                    <ModeCommentOutlinedIcon sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800, mb: 0.25 }}>Последний комментарий</Typography>
                    <Typography variant="body2" sx={{ color: ui.mutedText, ...clampTextSx(4) }}>
                      {latestCommentPreview}
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Карточка задачи недоступна.
          </Typography>
        )}
      </Box>
    </Drawer>
  );
}
