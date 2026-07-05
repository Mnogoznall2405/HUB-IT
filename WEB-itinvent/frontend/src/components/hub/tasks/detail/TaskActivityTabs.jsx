import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Checkbox,
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
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import FlagIcon from '@mui/icons-material/Flag';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ThumbUpOffAltIcon from '@mui/icons-material/ThumbUpOffAlt';
import MarkdownRenderer from '../../MarkdownRenderer';
import OverflowMenu from '../../../common/OverflowMenu';
import {
  TASK_DETAIL_TABS,
  getDefaultTaskDetailTab,
  getTaskCommentsTabLabel,
  getTaskUnreadBadgeLabel,
  normalizeTaskDetailTab,
} from '../../../../lib/taskNavigation';

export {
  TASK_DETAIL_TABS,
  getDefaultTaskDetailTab,
  normalizeTaskDetailTab,
} from '../../../../lib/taskNavigation';
import {
  clampTextSx,
  renderKvRows,
  renderObserverBlock,
  getTaskUserLabel,
  getChecklistStats,
  getTaskViewCount,
  getTaskLikeCount,
  formatMobileDueText,
  TaskMobilePersonRow,
  TaskMobileRailButton,
} from './taskDetailShared';

export function TaskActivityTabs({
  activeTab,
  onTabChange,
  comments,
  commentsCount,
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
  hideFilesTab = false,
  taskDiscussionEnabled = false,
  activityLoading = false,
}) {
  const commentsRef = useRef(null);
  const effectiveActiveTab = hideFilesTab && activeTab === 'files' ? 'comments' : activeTab;

  useEffect(() => {
    if (effectiveActiveTab !== 'comments' || !commentsRef.current) return;
    commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
  }, [effectiveActiveTab, comments]);

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
          value={effectiveActiveTab}
          onChange={(_, value) => onTabChange(value)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{
            minHeight: 40,
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, minHeight: 40, fontSize: '0.84rem' },
            '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
          }}
        >
          <Tab
            value="comments"
            label={getTaskCommentsTabLabel({
              taskDiscussionEnabled,
              count: commentsCount ?? comments.length,
            })}
          />
          {!hideFilesTab && <Tab value="files" label={`Файлы (${attachments.length})`} />}
          <Tab value="history" label={statusLog.length ? `История (${statusLog.length})` : 'История'} />
        </Tabs>
      </Box>

      <Box sx={{ px: 1.2, py: 1.2 }}>
        {effectiveActiveTab === 'comments' && (
          <Stack spacing={1}>
            {taskDiscussionEnabled ? (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                Новые сообщения по задаче — в корпоративном чате. Старые комментарии сохранены в архиве ниже.
              </Typography>
            ) : null}

            {comments.length > 0 ? (
              <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>
                {taskDiscussionEnabled ? 'Архив комментариев' : 'Комментарии'}
              </Typography>
            ) : null}

            <Box ref={commentsRef} sx={{ maxHeight: mobile ? 'none' : 380, overflowY: mobile ? 'visible' : 'auto', pr: 0.4 }}>
              {comments.length === 0 ? (
                <Typography variant="body2" sx={{ color: ui.mutedText }}>
                  {activityLoading
                    ? 'Загрузка комментариев…'
                    : (taskDiscussionEnabled ? 'Архивных комментариев пока нет.' : 'Комментариев пока нет.')}
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

            {!taskDiscussionEnabled ? (
              <>
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
              </>
            ) : null}
          </Stack>
        )}

        {!hideFilesTab && effectiveActiveTab === 'files' && (
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

        {effectiveActiveTab === 'history' && (
          <Stack spacing={0.95}>
            {statusLog.length === 0 ? (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                {activityLoading ? 'Загрузка истории…' : 'Переходы статусов пока не зафиксированы.'}
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
