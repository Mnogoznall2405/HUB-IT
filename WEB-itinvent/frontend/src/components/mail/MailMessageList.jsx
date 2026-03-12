import { useMemo } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import InboxIcon from '@mui/icons-material/Inbox';
import { getOfficeEmptyStateSx, getOfficeListRowSx } from '../../theme/officeUiTokens';
import { buildMailUiTokens } from './mailUiTokens';

export default function MailMessageList({
  listSx,
  viewMode,
  listData,
  loading,
  loadingMore,
  selectedItems,
  selectedId,
  onSelectId,
  onToggleSelectedListItem,
  onStartDragItems,
  formatTime,
  getAvatarColor,
  getInitials,
  hasActiveFilters,
  onClearListFilters,
  noResultsHint,
  onLoadMoreMessages,
  messageListRef,
  loadMoreSentinelRef,
  isMobile,
  density = 'comfortable',
  showPreviewSnippets = true,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const compact = density === 'compact';

  const formatParticipantLine = (participants) => {
    if (!Array.isArray(participants)) return '-';
    const items = participants
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          return String(item.email || item.name || item.display_name || item.address || '').trim();
        }
        return String(item || '').trim();
      })
      .filter(Boolean);
    return items.join(', ') || '-';
  };

  return (
    <Box sx={{ ...listSx, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <List
        ref={messageListRef}
        dense={compact}
        sx={{
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          scrollbarGutter: 'stable',
          p: 0,
          flex: 1,
          minHeight: 0,
          bgcolor: tokens.panelBg,
        }}
      >
        {loading ? (
          Array.from({ length: compact ? 9 : 7 }).map((_, index) => (
            <Box
              key={index}
              sx={{
                px: 1.5,
                py: compact ? 0.9 : 1.3,
                borderBottom: '1px solid',
                borderColor: tokens.panelBorder,
                bgcolor: index % 2 === 0 ? 'transparent' : tokens.surfaceBg,
              }}
            >
              <Skeleton variant="text" width="40%" />
              <Skeleton variant="text" width="75%" />
              <Skeleton variant="text" width="60%" />
            </Box>
          ))
        ) : listData.items.length === 0 ? (
          <Box sx={{ p: 1.6 }}>
            <Box sx={{ ...getOfficeEmptyStateSx(tokens, { p: 4, textAlign: 'center' }) }}>
              <InboxIcon sx={{ fontSize: 52, color: tokens.iconMuted, mb: 1.2 }} />
            <Typography variant="body2" color="text.secondary">
              {noResultsHint}
            </Typography>
            {hasActiveFilters ? (
              <Button size="small" onClick={onClearListFilters} sx={{ textTransform: 'none', mt: 1 }}>
                Снять фильтры
              </Button>
            ) : null}
            </Box>
          </Box>
        ) : (
          <>
            {listData.items.map((item) => {
              const rowId = String(
                viewMode === 'conversations'
                  ? (item.conversation_id || item.id || '')
                  : (item.id || '')
              );
              const selected = String(selectedId) === rowId;
              const unread = viewMode === 'conversations'
                ? Number(item.unread_count || 0) > 0
                : !item.is_read;
              const showAttachmentIndicator = Boolean(item.has_attachments);
              const conversationCountLabel = String(Number(item.messages_count || 0) || 1);
              const attachmentCountLabel = String(Number(item.attachments_count || 0) || 1);
              const senderLine = viewMode === 'conversations'
                ? formatParticipantLine(item.participants)
                : (item.sender || '-');
              const title = item.subject || '(без темы)';
              const previewLine = viewMode === 'conversations'
                ? (item.preview || '')
                : (item.body_preview || '');
              const rowIsSelectedInBulk = selectedItems.includes(String(item.id));

              return (
                <ListItemButton
                  key={rowId || `${title}_${senderLine}`}
                  selected={selected}
                  draggable={viewMode === 'messages'}
                  onDragStart={(event) => {
                    if (viewMode !== 'messages') return;
                    const draggedIds = rowIsSelectedInBulk
                      ? selectedItems
                      : [String(item.id)].filter(Boolean);
                    onStartDragItems?.(draggedIds, item);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', draggedIds.join(','));
                  }}
                  onClick={() => onSelectId(rowId, item)}
                  sx={{
                    px: { xs: compact ? 0.95 : 1.1, md: compact ? 1.1 : 1.35 },
                    py: compact ? 0.85 : 1.15,
                    alignItems: 'stretch',
                    ...getOfficeListRowSx(tokens, theme, {
                      selected,
                      unread,
                      accentColor: theme.palette.primary.main,
                    }),
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 10,
                      bottom: 10,
                      left: 6,
                      width: 2,
                      borderRadius: 999,
                      bgcolor: selected
                        ? theme.palette.primary.main
                        : unread
                          ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.6 : 0.4)
                          : 'transparent',
                    },
                  }}
                >
                  {viewMode === 'messages' ? (
                    <Checkbox
                      size="small"
                      checked={rowIsSelectedInBulk}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onToggleSelectedListItem(String(item.id))}
                      sx={{ mr: compact ? 0.15 : 0.35, mt: 0.1 }}
                    />
                  ) : null}

                  <ListItemAvatar sx={{ minWidth: compact ? 36 : 40, mt: 0.2 }}>
                    <Avatar
                      sx={{
                        width: compact ? 28 : 32,
                        height: compact ? 28 : 32,
                        fontSize: compact ? '0.68rem' : '0.72rem',
                        fontWeight: 700,
                        bgcolor: getAvatarColor(viewMode === 'conversations' ? senderLine : item.sender),
                      }}
                    >
                      {getInitials(viewMode === 'conversations' ? senderLine : item.sender)}
                    </Avatar>
                  </ListItemAvatar>

                  <Stack direction="row" spacing={0.9} sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ minWidth: 0 }}>
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{
                            display: 'block',
                            color: unread ? 'text.primary' : 'text.secondary',
                            fontWeight: unread ? 700 : 600,
                            fontSize: compact ? '0.71rem' : '0.75rem',
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          {senderLine}
                        </Typography>
                      </Stack>

                      <Typography
                        variant="body2"
                        sx={{
                          mt: compact ? 0.2 : 0.35,
                          fontWeight: unread ? 700 : 600,
                          fontSize: compact ? '0.81rem' : '0.87rem',
                          lineHeight: compact ? 1.22 : 1.28,
                          display: '-webkit-box',
                          WebkitLineClamp: isMobile ? 2 : 1,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          pr: 0.25,
                        }}
                      >
                        {title}
                      </Typography>

                      {showPreviewSnippets && previewLine ? (
                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: compact ? 0.25 : 0.45, minWidth: 0 }}>
                          {viewMode === 'conversations' ? (
                            <ForumOutlinedIcon sx={{ fontSize: 13, color: tokens.iconMuted, flexShrink: 0 }} />
                          ) : null}
                          <ListItemText
                            primary={null}
                            secondary={(
                              <Typography
                                variant="caption"
                                sx={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: isMobile ? 2 : 1,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  color: tokens.textSecondary,
                                  fontSize: compact ? '0.68rem' : '0.72rem',
                                  lineHeight: 1.3,
                                }}
                              >
                                {previewLine}
                              </Typography>
                            )}
                            sx={{ m: 0, minWidth: 0 }}
                          />
                        </Stack>
                      ) : null}
                    </Box>

                    <Stack
                      spacing={0.45}
                      sx={{
                        width: isMobile ? 46 : 58,
                        minWidth: isMobile ? 46 : 58,
                        alignItems: 'flex-end',
                        flexShrink: 0,
                        pt: 0.05,
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          color: tokens.textSecondary,
                          fontSize: compact ? '0.65rem' : '0.69rem',
                          lineHeight: 1.1,
                          whiteSpace: 'nowrap',
                          textAlign: 'right',
                        }}
                      >
                        {formatTime(viewMode === 'conversations' ? item.last_received_at : item.received_at)}
                      </Typography>
                      {viewMode === 'conversations' ? (
                        <Stack spacing={0.35} alignItems="flex-end">
                          <Tooltip title={`Сообщений: ${conversationCountLabel}`}>
                            <Stack direction="row" spacing={0.2} alignItems="center" sx={{ color: tokens.textSecondary, justifyContent: 'flex-end' }}>
                              <ForumOutlinedIcon sx={{ fontSize: 13 }} />
                              <Typography variant="caption" sx={{ fontSize: '0.68rem', fontWeight: 700 }}>
                                {conversationCountLabel}
                              </Typography>
                            </Stack>
                          </Tooltip>
                          {showAttachmentIndicator ? (
                            <Tooltip title="В диалоге есть вложения">
                              <AttachFileIcon sx={{ fontSize: 13, color: tokens.textSecondary }} />
                            </Tooltip>
                          ) : <Box sx={{ height: 13 }} />}
                        </Stack>
                      ) : showAttachmentIndicator ? (
                        <Tooltip title={`Вложений: ${attachmentCountLabel}`}>
                          <Stack direction="row" spacing={0.2} alignItems="center" sx={{ color: tokens.textSecondary, justifyContent: 'flex-end' }}>
                            <AttachFileIcon sx={{ fontSize: 13 }} />
                            <Typography variant="caption" sx={{ fontSize: '0.68rem', fontWeight: 700 }}>
                              {attachmentCountLabel}
                            </Typography>
                          </Stack>
                        </Tooltip>
                      ) : <Box sx={{ height: 16 }} />}
                      {unread ? (
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main' }} />
                      ) : null}
                    </Stack>
                  </Stack>
                </ListItemButton>
              );
            })}

            {listData.has_more ? (
              <Box
                ref={loadMoreSentinelRef}
                sx={{
                  p: 1.2,
                  borderTop: '1px solid',
                  borderColor: tokens.panelBorder,
                  textAlign: 'center',
                  bgcolor: tokens.surfaceBg,
                }}
              >
                <Button
                  size="small"
                  onClick={onLoadMoreMessages}
                  disabled={loadingMore}
                  sx={{ textTransform: 'none' }}
                >
                  {loadingMore ? 'Загрузка...' : 'Показать еще'}
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.45 }}>
                  Автодогрузка включена
                </Typography>
              </Box>
            ) : null}
          </>
        )}
      </List>
    </Box>
  );
}
