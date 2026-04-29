import { useMemo } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import {
  buildMailUiTokens,
  getMailBottomSheetPaperSx,
  getMailMenuPaperSx,
  getMailSheetHandleSx,
} from './mailUiTokens';

function SheetActionItem({ icon, label, onClick }) {
  return (
    <ListItemButton
      onClick={onClick}
      sx={{
        minHeight: 52,
        px: 2,
        py: 1,
      }}
    >
      <ListItemIcon sx={{ minWidth: 38 }}>
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{
          fontWeight: 600,
          fontSize: '0.96rem',
        }}
      />
    </ListItemButton>
  );
}

export default function MailToolsMenu({
  anchorEl,
  open,
  onClose,
  onOpenViewSettings,
  onMarkAllRead,
  mobile = false,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);

  const actionItems = [
    {
      id: 'mark-all-read',
      label: 'Отметить все как прочитанные',
      icon: <MarkEmailReadOutlinedIcon fontSize="small" />,
      onClick: onMarkAllRead,
    },
    {
      id: 'view-settings',
      label: 'Настройки вида',
      icon: <TuneOutlinedIcon fontSize="small" />,
      onClick: onOpenViewSettings,
    },
  ];

  const handleAction = (callback) => () => {
    onClose?.();
    callback?.();
  };

  if (mobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        PaperProps={{
          sx: getMailBottomSheetPaperSx(tokens),
        }}
      >
        <Box className="mail-scroll-hidden" sx={{ maxHeight: '82dvh', overflowY: 'auto' }}>
          <Box sx={{ px: 2, pt: 1.2, pb: 0.8 }}>
            <Box sx={getMailSheetHandleSx(tokens, { mb: 1.4 })} />
            <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: tokens.textPrimary }}>
              Действия
            </Typography>
          </Box>
          <List disablePadding>
            {actionItems.map((item) => (
              <SheetActionItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                onClick={handleAction(item.onClick)}
              />
            ))}
          </List>
        </Box>
      </Drawer>
    );
  }

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{
        sx: getMailMenuPaperSx(tokens, {
          mt: 0.75,
          minWidth: 240,
        }),
      }}
    >
      {actionItems.map((item) => (
        <MenuItem key={item.id} onClick={handleAction(item.onClick)} sx={{ minHeight: 46 }}>
          <ListItemIcon sx={{ minWidth: 34 }}>
            {item.icon}
          </ListItemIcon>
          <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: 600 }} />
        </MenuItem>
      ))}
    </Menu>
  );
}
