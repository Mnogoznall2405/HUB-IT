import { memo } from 'react';
import { Box, Checkbox, Drawer, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MyLocationIcon from '@mui/icons-material/MyLocation';

import EnhancedFabAction from './EnhancedFabAction';

const noop = () => {};

function DatabaseMobileActionSheet({
  theme,
  open = false,
  onClose = noop,
  isConsumablesMode = false,
  identifyWorkspaceLoading = false,
  hasExpandedVisible = false,
  onIdentifyWorkspace = noop,
  onCollapseAll = noop,
  onEnterSelectionMode = noop,
}) {
  const runAndClose = (callback) => {
    callback();
    onClose();
  };

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      ModalProps={{
        keepMounted: true,
        BackdropProps: {
          sx: {
            backdropFilter: 'blur(4px)',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
      }}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '60vh',
          px: 2,
          pb: 4,
          pt: 1,
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.1)',
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box
          sx={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
            mx: 'auto',
            mb: 0.5,
          }}
        />
        <Typography variant="subtitle1" sx={{ fontWeight: 700, textAlign: 'center' }}>
          Ещё
        </Typography>

        {!isConsumablesMode && (
          <EnhancedFabAction
            icon={<MyLocationIcon />}
            label="Определить ПК"
            description="Найти компьютер по сети"
            onClick={() => runAndClose(onIdentifyWorkspace)}
            loading={identifyWorkspaceLoading}
          />
        )}

        {hasExpandedVisible && (
          <EnhancedFabAction
            icon={<ExpandMoreIcon sx={{ transform: 'rotate(180deg)' }} />}
            label="Свернуть разделы"
            description="Скрыть все открытые группы"
            onClick={() => runAndClose(onCollapseAll)}
          />
        )}

        <EnhancedFabAction
          icon={<Checkbox />}
          label="Режим выбора"
          description="Выбрать несколько элементов"
          onClick={() => runAndClose(onEnterSelectionMode)}
          variant="outlined"
        />
      </Box>
    </Drawer>
  );
}

export default memo(DatabaseMobileActionSheet);
