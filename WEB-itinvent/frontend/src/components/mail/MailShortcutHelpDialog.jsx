import {
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  buildMailUiTokens,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
} from './mailUiTokens';

const SHORTCUTS = [
  { keys: 'C', description: 'Новое письмо' },
  { keys: '/', description: 'Фокус на поиске' },
  { keys: 'R', description: 'Обновить список и счетчики' },
  { keys: '?', description: 'Открыть это окно' },
  { keys: 'Delete', description: 'Удалить выбранное письмо' },
  { keys: 'Ctrl+Enter', description: 'Отправить письмо в compose' },
  { keys: 'Esc', description: 'Закрыть compose или диалог' },
];

export default function MailShortcutHelpDialog({ open, onClose }) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: getMailDialogPaperSx(tokens) }}>
      <DialogTitle sx={getMailDialogTitleSx(tokens)}>Горячие клавиши</DialogTitle>
      <DialogContent dividers sx={getMailDialogContentSx(tokens)}>
        <Stack spacing={1}>
          {SHORTCUTS.map((item, index) => (
            <Stack key={item.keys} spacing={1}>
              <Stack direction="row" justifyContent="space-between" spacing={2}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.keys}</Typography>
                <Typography variant="body2" color="text.secondary">{item.description}</Typography>
              </Stack>
              {index < SHORTCUTS.length - 1 ? <Divider /> : null}
            </Stack>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
