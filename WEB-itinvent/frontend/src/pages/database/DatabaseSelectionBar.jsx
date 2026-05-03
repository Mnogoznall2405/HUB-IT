import { memo } from 'react';
import { Button, IconButton, Paper, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { getOfficeQuietActionSx } from '../../theme/officeUiTokens';
import {
  PC_COMPONENT_OPTIONS,
  PRINTER_COMPONENT_OPTIONS,
} from './equipmentModel';

const noop = () => {};

const defaultCapabilities = {
  canCartridge: false,
  canBattery: false,
  canComponent: false,
  componentKind: null,
};

function DatabaseSelectionBar({
  theme,
  ui,
  selectedItemsCount = 0,
  selectedVisibleCount = 0,
  selectedHiddenCount = 0,
  selectedItemsCapabilities = defaultCapabilities,
  onClearSelection = noop,
  onOpenTransfer = noop,
  onOpenTransferAct = noop,
  onOpenCartridge = noop,
  onOpenBattery = noop,
  onOpenComponent = noop,
}) {
  const capabilities = { ...defaultCapabilities, ...selectedItemsCapabilities };

  const handleOpenComponent = () => {
    const kind = capabilities.componentKind || 'printer';
    const options = kind === 'pc' ? PC_COMPONENT_OPTIONS : PRINTER_COMPONENT_OPTIONS;

    onOpenComponent({
      componentKind: kind,
      componentType: options[0]?.value,
    });
  };

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        p: { xs: 1, sm: 1.5 },
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'center',
        backgroundColor: ui.panelSolid,
        color: theme.palette.text.primary,
        borderTop: '1px solid',
        borderColor: ui.borderSoft,
        boxShadow: ui.dialogShadow,
      }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mr: 1 }}>
        Выбрано: {selectedItemsCount}
      </Typography>
      {selectedHiddenCount > 0 ? (
        <Typography variant="caption" sx={{ mr: 1, opacity: 0.95 }}>
          {`В фильтре видно: ${selectedVisibleCount}, скрыто: ${selectedHiddenCount}`}
        </Typography>
      ) : null}
      <Button
        size="small"
        variant="outlined"
        color="primary"
        sx={getOfficeQuietActionSx(ui, theme, 'primary')}
        onClick={onOpenTransfer}
      >
        Переместить
      </Button>
      <Button
        size="small"
        variant="outlined"
        color="primary"
        sx={getOfficeQuietActionSx(ui, theme, 'primary')}
        onClick={onOpenTransferAct}
      >
        Акт
      </Button>
      <Button
        size="small"
        variant="outlined"
        color="warning"
        disabled={!capabilities.canCartridge}
        sx={getOfficeQuietActionSx(ui, theme, 'warning')}
        onClick={onOpenCartridge}
      >
        Картридж
      </Button>
      <Button
        size="small"
        variant="outlined"
        color="warning"
        disabled={!capabilities.canBattery}
        sx={getOfficeQuietActionSx(ui, theme, 'warning')}
        onClick={onOpenBattery}
      >
        Батарея
      </Button>
      <Button
        size="small"
        variant="outlined"
        color="primary"
        disabled={!capabilities.canComponent}
        sx={getOfficeQuietActionSx(ui, theme, 'primary')}
        onClick={handleOpenComponent}
      >
        Компонент
      </Button>
      <IconButton
        onClick={onClearSelection}
        aria-label="Очистить выбор"
        size="small"
        sx={getOfficeQuietActionSx(ui, theme)}
      >
        <CloseIcon />
      </IconButton>
    </Paper>
  );
}

export default memo(DatabaseSelectionBar);
