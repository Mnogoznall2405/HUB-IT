import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

import { isOrphanedTaskConversation } from './chatConversationModel';

export default function ChatPageConversationActionDialog({
  open = false,
  isLeave = false,
  title = 'Этот чат',
  conversation = null,
  conversationId = '',
  pending = false,
  onClose,
  onConfirm,
}) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onClose?.();
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>
        {isLeave ? 'Выйти из группы?' : 'Удалить чат?'}
      </DialogTitle>
      <DialogContent>
        <Typography color="text.secondary">
          {isLeave
            ? `Вы покинете группу «${title}». История останется у других участников.`
            : (
              isOrphanedTaskConversation(conversation)
                ? `Задача уже удалена. Чат «${title}» и вся переписка будут удалены у всех участников.`
                : (
                  String(conversation?.kind || '').trim() === 'group'
                    ? `Группа «${title}» и вся переписка будут удалены у всех участников.`
                    : `Чат «${title}» и вся переписка будут удалены у всех участников.`
                )
            )}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={pending}
        >
          Отмена
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => void onConfirm?.()}
          disabled={!conversationId || pending}
        >
          {pending
            ? 'Выполняется…'
            : (isLeave ? 'Выйти' : 'Удалить')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
