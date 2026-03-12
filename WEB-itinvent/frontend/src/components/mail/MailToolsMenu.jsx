import {
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import KeyboardCommandKeyOutlinedIcon from '@mui/icons-material/KeyboardCommandKeyOutlined';
import SyncAltOutlinedIcon from '@mui/icons-material/SyncAltOutlined';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';

export default function MailToolsMenu({
  anchorEl,
  open,
  onClose,
  onOpenItRequest,
  onOpenSignatureEditor,
  canManageUsers,
  onOpenTemplates,
  canToggleMailProfileMode,
  mailProfileModeLabel,
  mailProfileToggleLabel,
  onToggleMailProfileMode,
  onOpenShortcuts,
  onOpenViewSettings,
  onMarkAllRead,
}) {
  const handleAction = (callback) => () => {
    onClose();
    callback?.();
  };

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{ sx: { borderRadius: '12px', minWidth: 220 } }}
    >
      <MenuItem onClick={handleAction(onOpenItRequest)}>
        <ListItemIcon><AssignmentOutlinedIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Заявка в IT" secondary="Отправить шаблонную заявку" />
      </MenuItem>
      <MenuItem onClick={handleAction(onOpenSignatureEditor)}>
        <ListItemIcon><EmailOutlinedIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Подпись" secondary="Изменить подпись для писем" />
      </MenuItem>
      {canToggleMailProfileMode ? (
        <MenuItem onClick={handleAction(onToggleMailProfileMode)}>
          <ListItemIcon><SyncAltOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary={mailProfileToggleLabel || 'Переключить режим почты'}
            secondary={mailProfileModeLabel || 'Режим почтового профиля'}
          />
        </MenuItem>
      ) : null}
      {canManageUsers ? (
        <MenuItem onClick={handleAction(onOpenTemplates)}>
          <ListItemIcon><SettingsSuggestOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Шаблоны" secondary="Управление IT-шаблонами" />
        </MenuItem>
      ) : null}
      <MenuItem onClick={handleAction(onOpenViewSettings)}>
        <ListItemIcon><TuneOutlinedIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Вид и поведение" secondary="Область чтения, плотность, автопрочтение" />
      </MenuItem>
      <MenuItem onClick={handleAction(onMarkAllRead)}>
        <ListItemIcon><MarkEmailReadOutlinedIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Прочитать все" secondary="Отметить письма текущей выборки как прочитанные" />
      </MenuItem>
      <MenuItem onClick={handleAction(onOpenShortcuts)}>
        <ListItemIcon><KeyboardCommandKeyOutlinedIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Горячие клавиши" secondary="Список доступных сочетаний" />
      </MenuItem>
    </Menu>
  );
}
