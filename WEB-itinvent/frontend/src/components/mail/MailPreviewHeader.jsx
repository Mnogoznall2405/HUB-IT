import { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DraftsRoundedIcon from '@mui/icons-material/DraftsRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded';
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import ReplyAllRoundedIcon from '@mui/icons-material/ReplyAllRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded';
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded';
import {
  buildMailUiTokens,
  getMailBottomSheetPaperSx,
  getMailDialogPaperSx,
  getMailIconButtonSx,
  getMailMenuPaperSx,
  getMailMetaTextSx,
  getMailSurfaceButtonSx,
  getMailSheetHandleSx,
} from './mailUiTokens';
import { formatMailPersonWithEmail, getMailPersonDisplay } from './mailPeople';

const buildRecipients = (selectedMessage) => ([
  ...(Array.isArray(selectedMessage?.to_people) ? selectedMessage.to_people : (Array.isArray(selectedMessage?.to) ? selectedMessage.to : []))
    .map((value) => ({ type: 'Кому', value })),
  ...(Array.isArray(selectedMessage?.cc_people) ? selectedMessage.cc_people : (Array.isArray(selectedMessage?.cc) ? selectedMessage.cc : []))
    .map((value) => ({ type: 'Копия', value })),
  ...(Array.isArray(selectedMessage?.bcc_people) ? selectedMessage.bcc_people : (Array.isArray(selectedMessage?.bcc) ? selectedMessage.bcc : []))
    .map((value) => ({ type: 'Скрытая копия', value })),
]).filter((item) => String(formatMailPersonWithEmail(item.value, '') || '').trim());

const buildParticipantsLabel = (participants) => {
  if (!participants.length) return '';
  const items = participants.map((value) => getMailPersonDisplay(value, '')).filter(Boolean);
  if (items.length <= 3) return items.join(', ');
  return `${items.slice(0, 3).join(', ')} +${items.length - 3}`;
};

function SheetActionItem({ icon, label, onClick, danger = false, disabled = false }) {
  return (
    <ListItemButton onClick={onClick} disabled={disabled}>
      <ListItemIcon sx={{ minWidth: 38, color: danger ? 'error.main' : 'inherit' }}>
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{
          fontWeight: 600,
          color: danger ? 'error.main' : 'inherit',
        }}
      />
    </ListItemButton>
  );
}

function DesktopActionItem({ icon, label, onClick, danger = false, disabled = false }) {
  return (
    <MenuItem onClick={onClick} disabled={disabled} sx={{ minHeight: 46 }}>
      <ListItemIcon sx={{ minWidth: 34, color: danger ? 'error.main' : 'inherit' }}>
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{
          fontWeight: 600,
          color: danger ? 'error.main' : 'inherit',
        }}
      />
    </MenuItem>
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
  compactMobile = false,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [recipientsExpanded, setRecipientsExpanded] = useState(false);

  if (!selectedMessage) return null;

  const isConversation = viewMode === 'conversations'
    && Array.isArray(selectedConversation?.items)
    && selectedConversation.items.length > 0;
  const conversationItems = isConversation ? selectedConversation.items : [];
  const conversationParticipants = isConversation
    ? (
      Array.isArray(selectedConversation?.participant_people) && selectedConversation.participant_people.length > 0
        ? selectedConversation.participant_people
        : Array.from(
            new Set(
              conversationItems.flatMap((item) => {
                const parties = [
                  item?.sender_person || { display: item?.sender_display, email: item?.sender_email || item?.sender, name: item?.sender_name },
                  ...(
                    Array.isArray(item?.to_people) && item.to_people.length > 0
                      ? item.to_people
                      : (Array.isArray(item?.to) ? item.to : [])
                  ),
                ];
                return parties.filter(Boolean);
              }),
            ),
          )
    )
    : [];
  const senderLine = getMailPersonDisplay(
    selectedMessage?.sender_person || {
      display: selectedMessage?.sender_display,
      email: selectedMessage?.sender_email || selectedMessage?.sender,
      name: selectedMessage?.sender_name,
    },
    selectedMessage?.sender || '-',
  );

  const title = isConversation
    ? String(selectedConversation?.subject || selectedMessage.subject || '(без темы)')
    : String(selectedMessage.subject || '(без темы)');
  const recipients = buildRecipients(selectedMessage);
  const recipientCount = recipients.length;
  const participantsLabel = buildParticipantsLabel(conversationParticipants);
  const effectiveUnreadCount = isConversation
    ? Number(selectedConversation?.unread_count || 0)
    : (selectedMessage.is_read ? 0 : 1);
  const effectiveIsRead = effectiveUnreadCount === 0;
  const readActionIcon = effectiveIsRead
    ? <MarkEmailUnreadRoundedIcon fontSize="small" />
    : <MarkEmailReadRoundedIcon fontSize="small" />;
  const readActionLabel = effectiveIsRead ? 'Пометить как непрочитанное' : 'Пометить как прочитанное';
  const canArchive = folder !== 'archive' && folder !== 'trash';
  const availableMoveTargets = Array.isArray(moveTargets)
    ? moveTargets.filter((option) => option.value !== folder)
    : [];

  const handleAction = (callback) => () => {
    setMenuAnchorEl(null);
    setMobileSheetOpen(false);
    callback?.();
  };

  const handleMoveAction = (value) => () => {
    setMenuAnchorEl(null);
    setMobileSheetOpen(false);
    onMoveTargetChange?.(value);
    onMoveSelectedMessage?.(value);
  };

  const primaryActionLabel = folder === 'drafts' ? 'Открыть черновик' : 'Ответить';
  const primaryActionIcon = folder === 'drafts'
    ? <DraftsRoundedIcon fontSize="small" />
    : <ReplyRoundedIcon fontSize="small" />;
  const primaryActionHandler = folder === 'drafts'
    ? () => onOpenComposeFromDraft?.()
    : () => onOpenComposeFromMessage?.('reply');

  const actionItems = [
    ...(folder === 'drafts'
      ? [{
          id: 'open-draft',
          label: 'Открыть черновик',
          icon: <DraftsRoundedIcon fontSize="small" />,
          onClick: onOpenComposeFromDraft,
        }]
      : [
          {
            id: 'reply',
            label: 'Ответить',
            icon: <ReplyRoundedIcon fontSize="small" />,
            onClick: () => onOpenComposeFromMessage?.('reply'),
          },
          {
            id: 'reply-all',
            label: 'Ответить всем',
            icon: <ReplyAllRoundedIcon fontSize="small" />,
            onClick: () => onOpenComposeFromMessage?.('reply_all'),
          },
          {
            id: 'forward',
            label: 'Переслать',
            icon: <ForwardRoundedIcon fontSize="small" />,
            onClick: () => onOpenComposeFromMessage?.('forward'),
          },
        ]),
    {
      id: 'toggle-read',
      label: readActionLabel,
      icon: readActionIcon,
      onClick: onToggleReadState,
    },
    ...(folder === 'trash'
      ? [
          {
            id: 'restore',
            label: 'Восстановить',
            icon: <RestoreFromTrashRoundedIcon fontSize="small" />,
            onClick: onRestoreSelectedMessage,
          },
          {
            id: 'delete-forever',
            label: 'Удалить навсегда',
            icon: <DeleteForeverRoundedIcon fontSize="small" />,
            onClick: () => onDeleteSelectedMessage?.(true),
            danger: true,
          },
        ]
      : [{
          id: 'delete',
          label: 'Удалить',
          icon: <DeleteOutlineRoundedIcon fontSize="small" />,
          onClick: () => onDeleteSelectedMessage?.(false),
          danger: true,
        }]),
    ...(canArchive
      ? [{
          id: 'archive',
          label: 'Архив',
          icon: <ArchiveOutlinedIcon fontSize="small" />,
          onClick: onArchiveSelectedMessage,
        }]
      : []),
  ];

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: tokens.panelBorder }}>
      <Box
        className="mail-glass-header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          borderBottom: '1px solid',
          borderColor: alpha(theme.palette.common.white, tokens.isDark ? 0.06 : 0.7),
        }}
      >
        <Box sx={{ px: { xs: 1.1, md: 1.6 }, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {showBackButton ? (
              <IconButton
                aria-label="Назад к списку"
                onClick={onBackToList}
                sx={getMailIconButtonSx(tokens, {
                  width: 38,
                  height: 38,
                })}
              >
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
            ) : null}

            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                data-testid="mail-preview-title"
                sx={{
                  fontWeight: 800,
                  fontSize: compactMobile ? '0.96rem' : '1rem',
                  lineHeight: 1.18,
                  color: tokens.textPrimary,
                  display: '-webkit-box',
                  WebkitLineClamp: compactMobile ? 1 : 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {title}
              </Typography>
              <Typography data-testid="mail-preview-date" noWrap sx={getMailMetaTextSx(tokens, { mt: 0.15 })}>
                {formatFullDate(selectedMessage.received_at)}
              </Typography>
            </Box>

            <IconButton
              aria-label={primaryActionLabel}
              onClick={primaryActionHandler}
              disabled={messageActionLoading}
              sx={getMailIconButtonSx(tokens, {
                width: 38,
                height: 38,
                color: 'primary.main',
                bgcolor: alpha(theme.palette.primary.main, tokens.isDark ? 0.22 : 0.1),
                borderColor: alpha(theme.palette.primary.main, tokens.isDark ? 0.34 : 0.2),
              })}
            >
              {primaryActionIcon}
            </IconButton>

            <IconButton
              size="small"
              aria-label="Еще действия"
              data-testid={compactMobile ? 'mail-preview-mobile-more' : 'mail-preview-desktop-more'}
              onClick={(event) => {
                event.stopPropagation();
                if (compactMobile) {
                  setMobileSheetOpen(true);
                } else {
                  setMenuAnchorEl(event.currentTarget);
                }
              }}
              sx={getMailIconButtonSx(tokens, {
                width: 38,
                height: 38,
              })}
            >
              <MoreHorizRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <Box sx={{ px: { xs: 1.2, md: 1.8 }, py: { xs: 1.2, md: 1.5 }, bgcolor: tokens.panelBg }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.1 }}>
          <Avatar
            sx={{
              width: compactMobile ? 38 : 42,
              height: compactMobile ? 38 : 42,
              bgcolor: getAvatarColor(senderLine),
              fontWeight: 800,
            }}
          >
            {getInitials(senderLine)}
          </Avatar>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography data-testid="mail-preview-sender-label" sx={getMailMetaTextSx(tokens, { fontSize: tokens.fontSizeFine, fontWeight: 800, mb: 0.15 })}>
              {isConversation ? 'Диалог' : 'Отправитель'}
            </Typography>
            <Typography sx={{ fontWeight: 800, color: tokens.textPrimary, wordBreak: 'break-word' }}>
              {senderLine}
            </Typography>
            {isConversation ? (
              <Typography sx={{ mt: 0.2, color: tokens.textSecondary, fontSize: '0.8rem' }}>
                {participantsLabel ? `Участники: ${participantsLabel}` : 'Участники не определены'}
              </Typography>
            ) : (
              <Button
                onClick={() => setRecipientsExpanded((prev) => !prev)}
                sx={getMailSurfaceButtonSx(tokens, {
                  mt: 0.1,
                  px: 0.7,
                  py: 0.2,
                  minWidth: 0,
                  minHeight: 28,
                  color: tokens.textSecondary,
                  fontWeight: 600,
                })}
              >
                {`Кому: ${recipientCount || 0} получателей`}
                <KeyboardArrowDownRoundedIcon
                  sx={{
                    ml: 0.3,
                    fontSize: 18,
                    transform: recipientsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.16s ease',
                  }}
                />
              </Button>
            )}
          </Box>
        </Box>

        {!isConversation && recipientsExpanded ? (
          <Box sx={{ pl: { xs: 0, md: 0.2 }, pt: 1 }}>
            {recipients.length > 0 ? recipients.map((item, index) => (
              <Typography
                key={`${item.type}_${item.value}_${index}`}
                sx={{ color: tokens.textSecondary, fontSize: '0.8rem', wordBreak: 'break-word' }}
              >
                <Box component="span" sx={{ fontWeight: 700, color: tokens.textPrimary }}>
                  {item.type}
                </Box>
                {`: ${formatMailPersonWithEmail(item.value)}`}
              </Typography>
            )) : (
              <Typography sx={{ color: tokens.textSecondary, fontSize: '0.8rem' }}>
                Получатели не указаны
              </Typography>
            )}
          </Box>
        ) : null}
      </Box>

      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={() => setMenuAnchorEl(null)}
        PaperProps={{
          sx: getMailMenuPaperSx(tokens, {
            mt: 0.5,
            minWidth: 260,
          }),
        }}
      >
        {actionItems.map((item) => (
          <DesktopActionItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            danger={item.danger}
            disabled={messageActionLoading}
            onClick={handleAction(item.onClick)}
          />
        ))}
        {availableMoveTargets.length > 0 ? <Divider /> : null}
        {availableMoveTargets.map((option) => (
          <MenuItem key={option.value} onClick={handleMoveAction(option.value)}>
            <ListItemText primary={`Переместить в ${option.label}`} primaryTypographyProps={{ fontWeight: 600 }} />
          </MenuItem>
        ))}
        <Divider />
        <DesktopActionItem
          icon={<SubjectRoundedIcon fontSize="small" />}
          label="Заголовки"
          onClick={handleAction(onOpenHeaders)}
        />
        <DesktopActionItem
          icon={<DownloadRoundedIcon fontSize="small" />}
          label="Скачать .eml"
          onClick={handleAction(onDownloadSource)}
        />
        <DesktopActionItem
          icon={<PrintOutlinedIcon fontSize="small" />}
          label="Печать"
          onClick={handleAction(onPrintSelectedMessage)}
        />
      </Menu>

      <Drawer
        anchor="bottom"
        open={mobileSheetOpen}
        onClose={() => setMobileSheetOpen(false)}
        ModalProps={{ keepMounted: true, sx: { zIndex: theme.zIndex.drawer + 4 } }}
        PaperProps={{
          'data-testid': 'mail-preview-mobile-actions-sheet',
          sx: getMailBottomSheetPaperSx(tokens),
        }}
      >
        <Box sx={{ pt: 1 }}>
          <Box sx={getMailSheetHandleSx(tokens, { mb: 1 })} />
          <List disablePadding>
            {actionItems.map((item) => (
              <SheetActionItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                danger={item.danger}
                disabled={messageActionLoading}
                onClick={handleAction(item.onClick)}
              />
            ))}
            {availableMoveTargets.length > 0 ? <Divider /> : null}
            {availableMoveTargets.map((option) => (
              <SheetActionItem
                key={option.value}
                icon={null}
                label={`Переместить в ${option.label}`}
                disabled={messageActionLoading}
                onClick={handleMoveAction(option.value)}
              />
            ))}
            <Divider />
            <SheetActionItem
              icon={<SubjectRoundedIcon fontSize="small" />}
              label="Заголовки"
              onClick={handleAction(onOpenHeaders)}
            />
            <SheetActionItem
              icon={<DownloadRoundedIcon fontSize="small" />}
              label="Скачать .eml"
              onClick={handleAction(onDownloadSource)}
            />
            <SheetActionItem
              icon={<PrintOutlinedIcon fontSize="small" />}
              label="Печать"
              onClick={handleAction(onPrintSelectedMessage)}
            />
          </List>
        </Box>
      </Drawer>
    </Box>
  );
}
