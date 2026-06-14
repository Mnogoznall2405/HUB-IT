import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import BookmarkAddedOutlinedIcon from '@mui/icons-material/BookmarkAddedOutlined';
import BookmarkBorderOutlinedIcon from '@mui/icons-material/BookmarkBorderOutlined';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DraftsRoundedIcon from '@mui/icons-material/DraftsRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded';
import MarkEmailUnreadRoundedIcon from '@mui/icons-material/MarkEmailUnreadRounded';
import ReplyAllRoundedIcon from '@mui/icons-material/ReplyAllRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import RestoreFromTrashRoundedIcon from '@mui/icons-material/RestoreFromTrashRounded';

export function buildMailPreviewReadState(selectedMessage, selectedConversation, viewMode) {
  const isConversation = viewMode === 'conversations'
    && Array.isArray(selectedConversation?.items)
    && selectedConversation.items.length > 0;
  const effectiveUnreadCount = isConversation
    ? Number(selectedConversation?.unread_count || 0)
    : (selectedMessage?.is_read ? 0 : 1);
  const effectiveIsRead = effectiveUnreadCount === 0;
  const readActionIcon = effectiveIsRead
    ? <MarkEmailUnreadRoundedIcon fontSize="small" />
    : <MarkEmailReadRoundedIcon fontSize="small" />;
  const readActionLabel = effectiveIsRead ? 'Пометить как непрочитанное' : 'Пометить как прочитанное';

  return {
    effectiveIsRead,
    readActionIcon,
    readActionLabel,
  };
}

export function buildMailPreviewActionItems({
  folder,
  readActionIcon,
  readActionLabel,
  onOpenComposeFromDraft,
  onOpenComposeFromMessage,
  onToggleReadState,
  onToggleImportance,
  messageImportance = 'normal',
  onRestoreSelectedMessage,
  onDeleteSelectedMessage,
  onArchiveSelectedMessage,
  canArchive,
}) {
  const isImportant = String(messageImportance || 'normal').toLowerCase() === 'high';
  return [
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
    ...(typeof onToggleImportance === 'function' && folder !== 'drafts'
      ? [{
          id: 'toggle-importance',
          label: isImportant ? 'Снять важность' : 'Пометить важным',
          icon: isImportant
            ? <BookmarkAddedOutlinedIcon fontSize="small" />
            : <BookmarkBorderOutlinedIcon fontSize="small" />,
          onClick: onToggleImportance,
        }]
      : []),
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
}

export function buildMailPreviewMobileQuickActionIds(folder) {
  return new Set([
    folder === 'drafts' ? 'open-draft' : 'reply',
    'forward',
    'toggle-read',
    folder === 'trash' ? 'delete-forever' : 'delete',
  ]);
}

export function filterMailPreviewMobileSheetActions(actionItems, folder) {
  const mobileQuickActionIds = buildMailPreviewMobileQuickActionIds(folder);
  return actionItems.filter((item) => !mobileQuickActionIds.has(item.id));
}
