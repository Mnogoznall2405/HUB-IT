import { useMemo, useState } from 'react';
import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DraftsRoundedIcon from '@mui/icons-material/DraftsRounded';
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded';
import {
  buildMailPreviewActionItems,
  buildMailPreviewReadState,
  filterMailPreviewMobileSheetActions,
} from './mailPreviewActions';
import MailMobileBottomActionButton from './MailMobileBottomActionButton';
import {
  buildMailUiTokens,
  getMailBottomSheetPaperSx,
  getMailMetaTextSx,
  getMailMobileBottomBarSx,
  getMailSheetHandleSx,
} from './mailUiTokens';

function SheetActionItem({ icon, label, onClick, danger = false, disabled = false, testId }) {
  return (
    <ListItemButton data-testid={testId} onClick={onClick} disabled={disabled}>
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

export default function MailPreviewMobileActionBar({
  selectedMessage,
  selectedConversation,
  viewMode,
  folder,
  messageActionLoading,
  onOpenComposeFromDraft,
  onOpenComposeFromMessage,
  onToggleReadState,
  onToggleImportance,
  onRestoreSelectedMessage,
  onDeleteSelectedMessage,
  onArchiveSelectedMessage,
  onMoveTargetChange,
  onMoveSelectedMessage,
  moveTargets,
  onOpenHeaders,
  onDownloadSource,
  onPrintSelectedMessage,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mobileMoveSheetOpen, setMobileMoveSheetOpen] = useState(false);

  if (!selectedMessage) return null;

  const canArchive = folder !== 'archive' && folder !== 'trash';
  const availableMoveTargets = Array.isArray(moveTargets)
    ? moveTargets.filter((option) => option.value !== folder)
    : [];
  const { effectiveIsRead, readActionIcon, readActionLabel } = buildMailPreviewReadState(
    selectedMessage,
    selectedConversation,
    viewMode,
  );
  const actionItems = buildMailPreviewActionItems({
    folder,
    readActionIcon,
    readActionLabel,
    onOpenComposeFromDraft,
    onOpenComposeFromMessage,
    onToggleReadState,
    onToggleImportance,
    messageImportance: selectedMessage?.importance,
    onRestoreSelectedMessage,
    onDeleteSelectedMessage,
    onArchiveSelectedMessage,
    canArchive,
  });
  const mobileSheetActionItems = filterMailPreviewMobileSheetActions(actionItems, folder);
  const mobileForwardDisabled = folder === 'drafts' || messageActionLoading;
  const mobileReadActionLabel = effectiveIsRead ? 'Не проч.' : 'Прочитано';
  const primaryActionIcon = folder === 'drafts'
    ? <DraftsRoundedIcon fontSize="small" />
    : <ReplyRoundedIcon fontSize="small" />;
  const primaryActionHandler = folder === 'drafts'
    ? () => onOpenComposeFromDraft?.()
    : () => onOpenComposeFromMessage?.('reply');

  const handleAction = (callback) => () => {
    setMobileSheetOpen(false);
    setMobileMoveSheetOpen(false);
    callback?.();
  };

  const handleMoveAction = (value) => () => {
    setMobileSheetOpen(false);
    setMobileMoveSheetOpen(false);
    onMoveTargetChange?.(value);
    onMoveSelectedMessage?.(value);
  };

  const handleOpenMobileMoveSheet = () => {
    if (!availableMoveTargets.length || messageActionLoading) return;
    setMobileSheetOpen(false);
    setMobileMoveSheetOpen(true);
  };

  return (
    <>
      <Box
        data-testid="mail-preview-mobile-bottom-bar"
        data-layout="inline"
        sx={getMailMobileBottomBarSx(tokens)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 0.35 }}>
          <MailMobileBottomActionButton
            icon={primaryActionIcon}
            label={folder === 'drafts' ? 'Открыть' : 'Ответить'}
            disabled={messageActionLoading}
            onClick={primaryActionHandler}
            tokens={tokens}
          />
          <MailMobileBottomActionButton
            icon={<ForwardRoundedIcon />}
            label="Переслать"
            disabled={mobileForwardDisabled}
            onClick={() => onOpenComposeFromMessage?.('forward')}
            tokens={tokens}
          />
          <MailMobileBottomActionButton
            icon={readActionIcon}
            label={mobileReadActionLabel}
            disabled={messageActionLoading}
            onClick={onToggleReadState}
            tokens={tokens}
          />
          <MailMobileBottomActionButton
            icon={folder === 'trash' ? <DeleteForeverRoundedIcon /> : <DeleteOutlineRoundedIcon />}
            label="Удалить"
            danger
            disabled={messageActionLoading}
            onClick={() => onDeleteSelectedMessage?.(folder === 'trash')}
            tokens={tokens}
          />
          <MailMobileBottomActionButton
            icon={<MoreHorizRoundedIcon />}
            label="Ещё"
            disabled={messageActionLoading}
            onClick={() => setMobileSheetOpen(true)}
            tokens={tokens}
          />
        </Box>
      </Box>

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
          <List
            disablePadding
            sx={{
              maxHeight: 'min(72dvh, 520px)',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {mobileSheetActionItems.map((item) => (
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
            {availableMoveTargets.length > 0 ? (
              <SheetActionItem
                icon={<DriveFileMoveRoundedIcon fontSize="small" />}
                label={'\u041f\u0435\u0440\u0435\u043c\u0435\u0441\u0442\u0438\u0442\u044c'}
                testId="mail-preview-mobile-open-move-sheet"
                disabled={messageActionLoading}
                onClick={handleOpenMobileMoveSheet}
              />
            ) : null}
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

      <Drawer
        anchor="bottom"
        open={mobileMoveSheetOpen}
        onClose={() => setMobileMoveSheetOpen(false)}
        ModalProps={{ keepMounted: true, sx: { zIndex: theme.zIndex.drawer + 5 } }}
        PaperProps={{
          'data-testid': 'mail-preview-mobile-move-sheet',
          sx: getMailBottomSheetPaperSx(tokens, {
            maxHeight: '82dvh',
          }),
        }}
      >
        <Box sx={{ pt: 1 }}>
          <Box sx={getMailSheetHandleSx(tokens, { mb: 1 })} />
          <Box sx={{ px: 2, pb: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: tokens.textPrimary }}>
              {'\u041f\u0435\u0440\u0435\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0432 \u043f\u0430\u043f\u043a\u0443'}
            </Typography>
            <Typography sx={getMailMetaTextSx(tokens, { mt: 0.25 })}>
              {'\u041f\u0430\u043f\u043a\u0438 \u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u043a\u0440\u0443\u0447\u0438\u0432\u0430\u0442\u044c.'}
            </Typography>
          </Box>
          <Divider />
          <List
            disablePadding
            sx={{
              maxHeight: 'min(58dvh, 420px)',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              py: 0.4,
            }}
          >
            {availableMoveTargets.map((option) => (
              <ListItemButton
                key={option.value}
                data-testid={`mail-preview-mobile-move-option-${option.value}`}
                disabled={messageActionLoading}
                onClick={handleMoveAction(option.value)}
                sx={{
                  minHeight: 48,
                  px: 2,
                  '&.Mui-focusVisible': {
                    bgcolor: tokens.surfaceHover,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 38, color: tokens.textSecondary }}>
                  <DriveFileMoveRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={option.label}
                  primaryTypographyProps={{
                    fontWeight: 700,
                    noWrap: true,
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>
    </>
  );
}
