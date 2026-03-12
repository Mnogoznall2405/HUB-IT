import { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DeleteIcon from '@mui/icons-material/Delete';
import DraftsIcon from '@mui/icons-material/Drafts';
import DownloadIcon from '@mui/icons-material/Download';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import ForwardIcon from '@mui/icons-material/Forward';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import ReplyAllIcon from '@mui/icons-material/ReplyAll';
import ReplyIcon from '@mui/icons-material/Reply';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined';
import { buildMailUiTokens, getMailSoftActionStyles } from './mailUiTokens';

const buildParticipantsLabel = (participants) => {
  if (!participants.length) return '';
  if (participants.length <= 3) return participants.join(', ');
  return `${participants.slice(0, 3).join(', ')} +${participants.length - 3}`;
};

function HeaderActionButton({
  primary = false,
  color = 'inherit',
  startIcon,
  children,
  tokens,
  sx,
  ...props
}) {
  const theme = useTheme();
  const softActionStyles = getMailSoftActionStyles(theme, tokens, color);

  return (
    <Button
      size="small"
      variant={primary ? 'contained' : 'text'}
      startIcon={startIcon}
      sx={{
        minHeight: 36,
        px: 1.25,
        borderRadius: '10px',
        textTransform: 'none',
        fontWeight: primary ? 700 : 600,
        letterSpacing: 0,
        border: primary ? 'none' : '1px solid',
        boxShadow: 'none',
        ...(primary
          ? {
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              '&:hover': {
                bgcolor: theme.palette.primary.dark,
                boxShadow: 'none',
              },
            }
          : softActionStyles),
        ...sx,
      }}
      {...props}
    >
      {children}
    </Button>
  );
}

export default function MailPreviewHeader({
  selectedMessage,
  selectedConversation,
  viewMode,
  folder,
  messageActionLoading,
  onOpenComposeFromDraft,
  onOpenComposeFromMessage,
  onToggleReadState,
  onRestoreSelectedMessage,
  onDeleteSelectedMessage,
  onArchiveSelectedMessage,
  moveTarget,
  onMoveTargetChange,
  onMoveSelectedMessage,
  moveTargets,
  onOpenHeaders,
  onDownloadSource,
  onPrintSelectedMessage,
  getAvatarColor,
  getInitials,
  formatFullDate,
  showBackButton,
  onBackToList,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [moreAnchorEl, setMoreAnchorEl] = useState(null);

  if (!selectedMessage) return null;

  const isConversation = viewMode === 'conversations'
    && Array.isArray(selectedConversation?.items)
    && selectedConversation.items.length > 0;

  const conversationItems = isConversation ? selectedConversation.items : [];
  const conversationParticipants = isConversation
    ? Array.from(
        new Set(
          conversationItems.flatMap((item) => {
            const parties = [item?.sender, ...(Array.isArray(item?.to) ? item.to : [])];
            return parties.map((party) => String(party || '').trim()).filter(Boolean);
          })
        )
      )
    : [];

  const title = isConversation
    ? String(selectedConversation?.subject || selectedMessage.subject || '(без темы)')
    : String(selectedMessage.subject || '(без темы)');

  const subtitle = isConversation
    ? `Последнее сообщение: ${formatFullDate(selectedMessage.received_at)}`
    : formatFullDate(selectedMessage.received_at);

  const participantsLabel = buildParticipantsLabel(conversationParticipants);
  const canArchive = folder !== 'archive' && folder !== 'trash';
  const showMoveControls = folder !== 'trash';
  const availableMoveTargets = Array.isArray(moveTargets)
    ? moveTargets.filter((option) => option.value !== folder)
    : [];

  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 2 },
        py: { xs: 1.25, md: 1.4 },
        borderBottom: '1px solid',
        borderColor: tokens.shellBorder,
        bgcolor: tokens.panelBg,
      }}
    >
      <Stack spacing={1.15}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          {showBackButton ? (
            <IconButton
              size="small"
              onClick={onBackToList}
              sx={{
                mt: 0.1,
                width: 36,
                height: 36,
                borderRadius: '10px',
                border: '1px solid',
                borderColor: tokens.actionBorder,
                bgcolor: tokens.actionBg,
                color: tokens.iconColor,
                '&:hover': {
                  borderColor: tokens.surfaceBorder,
                  bgcolor: tokens.actionHover,
                },
              }}
            >
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: tokens.textPrimary,
                fontSize: { xs: '0.98rem', md: '1.08rem' },
                lineHeight: 1.22,
                wordBreak: 'break-word',
              }}
            >
              {title}
            </Typography>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 0.35, sm: 0.9 }}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              sx={{ mt: 0.35 }}
            >
              <Typography variant="caption" sx={{ color: tokens.textSecondary }}>
                {subtitle}
              </Typography>
              {isConversation ? (
                <Chip
                  size="small"
                  label={`${conversationItems.length} сообщ.`}
                  sx={{
                    height: 22,
                    fontWeight: 700,
                    bgcolor: tokens.surfaceBg,
                    border: '1px solid',
                    borderColor: tokens.surfaceBorder,
                    color: tokens.textPrimary,
                  }}
                />
              ) : null}
            </Stack>
          </Box>
        </Stack>

        {isConversation ? (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            sx={{
              px: 1,
              py: 0.95,
              borderRadius: '12px',
              bgcolor: tokens.surfaceBg,
              border: '1px solid',
              borderColor: tokens.surfaceBorder,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <Avatar
                sx={{
                  width: 34,
                  height: 34,
                  bgcolor: getAvatarColor(selectedMessage.sender),
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                {getInitials(selectedMessage.sender)}
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: tokens.textPrimary, wordBreak: 'break-word' }}>
                  {selectedMessage.sender || '-'}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.15, color: tokens.textSecondary, wordBreak: 'break-word' }}
                >
                  {participantsLabel ? `Участники: ${participantsLabel}` : 'Участники не определены'}
                </Typography>
              </Box>
            </Stack>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1.1} alignItems="flex-start">
            <Avatar
              sx={{
                width: 38,
                height: 38,
                bgcolor: getAvatarColor(selectedMessage.sender),
                fontSize: '0.82rem',
                fontWeight: 700,
              }}
            >
              {getInitials(selectedMessage.sender)}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, color: tokens.textPrimary, wordBreak: 'break-word' }}>
                {selectedMessage.sender || '-'}
              </Typography>
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 0.25, color: tokens.textSecondary, wordBreak: 'break-word' }}
              >
                {`Кому: ${(selectedMessage.to || []).join(', ') || '-'}`}
              </Typography>
              {selectedMessage.cc?.length > 0 ? (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.15, color: tokens.textSecondary, wordBreak: 'break-word' }}
                >
                  {`Копия: ${selectedMessage.cc.join(', ')}`}
                </Typography>
              ) : null}
              {selectedMessage.bcc?.length > 0 ? (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.15, color: tokens.textSecondary, wordBreak: 'break-word' }}
                >
                  {`Скрытая копия: ${selectedMessage.bcc.join(', ')}`}
                </Typography>
              ) : null}
            </Box>
          </Stack>
        )}

        <Stack
          direction={{ xs: 'column', xl: 'row' }}
          spacing={1}
          alignItems={{ xs: 'stretch', xl: 'center' }}
          justifyContent="space-between"
          sx={{
            px: 1,
            py: 0.95,
            borderRadius: '14px',
            bgcolor: tokens.surfaceBg,
            border: '1px solid',
            borderColor: tokens.panelBorder,
            boxShadow: 'none',
          }}
        >
          <Stack direction="row" spacing={0.55} flexWrap="wrap" useFlexGap sx={{ flex: 1, alignItems: 'center' }}>
            {folder === 'drafts' ? (
              <HeaderActionButton
                primary
                tokens={tokens}
                startIcon={<DraftsIcon />}
                onClick={onOpenComposeFromDraft}
                disabled={messageActionLoading}
              >
                Открыть черновик
              </HeaderActionButton>
            ) : (
              <>
                <HeaderActionButton
                  primary
                  tokens={tokens}
                  startIcon={<ReplyIcon />}
                  onClick={() => onOpenComposeFromMessage('reply')}
                  disabled={messageActionLoading}
                >
                  Ответить
                </HeaderActionButton>
                <HeaderActionButton
                  tokens={tokens}
                  startIcon={<ReplyAllIcon />}
                  onClick={() => onOpenComposeFromMessage('reply_all')}
                  disabled={messageActionLoading}
                >
                  Всем
                </HeaderActionButton>
                <HeaderActionButton
                  tokens={tokens}
                  startIcon={<ForwardIcon />}
                  onClick={() => onOpenComposeFromMessage('forward')}
                  disabled={messageActionLoading}
                >
                  Переслать
                </HeaderActionButton>
              </>
            )}

            <HeaderActionButton
              tokens={tokens}
              startIcon={selectedMessage.is_read ? <MarkEmailUnreadIcon /> : <MarkEmailReadIcon />}
              onClick={onToggleReadState}
              disabled={messageActionLoading}
            >
              {selectedMessage.is_read ? 'Непрочитано' : 'Прочитано'}
            </HeaderActionButton>

            {folder === 'trash' ? (
              <>
                <HeaderActionButton
                  tokens={tokens}
                  color="success"
                  startIcon={<RestoreFromTrashIcon />}
                  onClick={onRestoreSelectedMessage}
                  disabled={messageActionLoading}
                >
                  Восстановить
                </HeaderActionButton>
                <HeaderActionButton
                  tokens={tokens}
                  color="error"
                  startIcon={<DeleteForeverIcon />}
                  onClick={() => onDeleteSelectedMessage(true)}
                  disabled={messageActionLoading}
                >
                  Удалить навсегда
                </HeaderActionButton>
              </>
            ) : (
              <HeaderActionButton
                tokens={tokens}
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => onDeleteSelectedMessage(false)}
                disabled={messageActionLoading}
              >
                Удалить
              </HeaderActionButton>
            )}

            {canArchive ? (
              <HeaderActionButton
                tokens={tokens}
                startIcon={<ArchiveOutlinedIcon />}
                onClick={onArchiveSelectedMessage}
                disabled={messageActionLoading}
              >
                Архив
              </HeaderActionButton>
            ) : null}

            <IconButton
              size="small"
              aria-label="Еще действия"
              onClick={(event) => setMoreAnchorEl(event.currentTarget)}
              disabled={messageActionLoading}
              sx={{
                width: 36,
                height: 36,
                borderRadius: '10px',
                border: '1px solid',
                borderColor: tokens.actionBorder,
                bgcolor: tokens.actionBg,
                color: tokens.iconColor,
                '&:hover': {
                  borderColor: tokens.surfaceBorder,
                  bgcolor: tokens.actionHover,
                },
              }}
            >
              <MoreHorizIcon fontSize="small" />
            </IconButton>
          </Stack>

          {showMoveControls ? (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={0.75}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              sx={{
                width: { xs: '100%', xl: 'auto' },
                minWidth: { xl: 308 },
                p: 0.75,
                borderRadius: '12px',
                bgcolor: tokens.panelBg,
                border: '1px solid',
                borderColor: tokens.surfaceBorder,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  px: 0.25,
                  fontWeight: 700,
                  color: tokens.textSecondary,
                  whiteSpace: 'nowrap',
                }}
              >
                Перемещение
              </Typography>

              <FormControl size="small" sx={{ minWidth: { xs: 0, sm: 190 }, flex: 1 }}>
                <Select
                  value={moveTarget}
                  displayEmpty
                  onChange={(event) => onMoveTargetChange(String(event.target.value || ''))}
                  renderValue={(value) => {
                    if (!value) {
                      return (
                        <Typography component="span" sx={{ color: tokens.textSecondary, fontSize: '0.82rem' }}>
                          Куда переместить
                        </Typography>
                      );
                    }

                    return availableMoveTargets.find((option) => option.value === value)?.label || 'Куда переместить';
                  }}
                  sx={{
                    borderRadius: '10px',
                    fontSize: '0.82rem',
                    bgcolor: tokens.actionBg,
                    color: tokens.textPrimary,
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: tokens.actionBorder,
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: tokens.surfaceBorder,
                    },
                    '& .MuiSelect-icon': {
                      color: tokens.iconColor,
                    },
                  }}
                >
                  <MenuItem value="">Куда переместить</MenuItem>
                  {availableMoveTargets.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <HeaderActionButton
                tokens={tokens}
                startIcon={<DriveFileMoveIcon />}
                onClick={onMoveSelectedMessage}
                disabled={messageActionLoading || !moveTarget}
                sx={{ whiteSpace: 'nowrap', justifyContent: 'center' }}
              >
                Переместить
              </HeaderActionButton>
            </Stack>
          ) : null}
        </Stack>

        <Menu
          anchorEl={moreAnchorEl}
          open={Boolean(moreAnchorEl)}
          onClose={() => setMoreAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          PaperProps={{
            sx: {
              mt: 0.5,
              minWidth: 220,
              borderRadius: '14px',
              bgcolor: tokens.menuBg,
              border: '1px solid',
              borderColor: tokens.panelBorder,
              boxShadow: tokens.shadow,
            },
          }}
        >
          <MenuItem onClick={() => { setMoreAnchorEl(null); onOpenHeaders?.(); }}>
            <ListItemIcon sx={{ color: tokens.iconColor }}>
              <SubjectOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Заголовки"
              secondary="Технические headers письма"
              primaryTypographyProps={{ fontWeight: 600 }}
              secondaryTypographyProps={{ sx: { color: tokens.textSecondary } }}
            />
          </MenuItem>
          <MenuItem onClick={() => { setMoreAnchorEl(null); onDownloadSource?.(); }}>
            <ListItemIcon sx={{ color: tokens.iconColor }}>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Скачать .eml"
              secondary="Исходник письма"
              primaryTypographyProps={{ fontWeight: 600 }}
              secondaryTypographyProps={{ sx: { color: tokens.textSecondary } }}
            />
          </MenuItem>
          <MenuItem onClick={() => { setMoreAnchorEl(null); onPrintSelectedMessage?.(); }}>
            <ListItemIcon sx={{ color: tokens.iconColor }}>
              <PrintOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Печать"
              secondary="Открыть печатную версию"
              primaryTypographyProps={{ fontWeight: 600 }}
              secondaryTypographyProps={{ sx: { color: tokens.textSecondary } }}
            />
          </MenuItem>
        </Menu>
      </Stack>
    </Box>
  );
}
