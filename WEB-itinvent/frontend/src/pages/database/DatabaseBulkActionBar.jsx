import { memo, useCallback, useState } from 'react';
import {
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Slide,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import BatteryFullOutlinedIcon from '@mui/icons-material/BatteryFullOutlined';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import MyLocationOutlinedIcon from '@mui/icons-material/MyLocationOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';

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

const MOBILE_BAR_HEIGHT = 50;
const MOBILE_BAR_GAP = 8;

function DatabaseBulkMobileActionButton({
  icon,
  label,
  disabled = false,
  onClick,
  theme,
  ui,
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      sx={{
        minWidth: 0,
        width: 52,
        height: 42,
        px: 0.25,
        py: 0.35,
        borderRadius: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.15,
        color: theme.palette.text.primary,
        bgcolor: 'transparent',
        textTransform: 'none',
        fontWeight: 700,
        fontSize: '0.62rem',
        lineHeight: 1.05,
        flexShrink: 0,
        '& .MuiButton-startIcon': {
          m: 0,
          '& svg': { fontSize: 20 },
        },
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
        },
        '&:active': {
          transform: 'scale(0.96)',
        },
        '&.Mui-disabled': {
          opacity: 0.38,
          color: theme.palette.text.disabled,
        },
      }}
      startIcon={icon}
    >
      {label}
    </Button>
  );
}

function DatabaseBulkMobileMoreSheet({
  open,
  onClose,
  theme,
  ui,
  capabilities,
  onOpenCartridge,
  onOpenBattery,
  onOpenComponent,
  onClearSelection,
}) {
  const runAndClose = (callback) => {
    callback();
    onClose();
  };

  const maintenanceItems = [
    {
      key: 'cartridge',
      label: 'Картридж',
      icon: <PrintOutlinedIcon fontSize="small" />,
      disabled: !capabilities.canCartridge,
      onClick: onOpenCartridge,
    },
    {
      key: 'battery',
      label: 'Батарея',
      icon: <BatteryFullOutlinedIcon fontSize="small" />,
      disabled: !capabilities.canBattery,
      onClick: onOpenBattery,
    },
    {
      key: 'component',
      label: 'Компонент',
      icon: <StorageOutlinedIcon fontSize="small" />,
      disabled: !capabilities.canComponent,
      onClick: onOpenComponent,
    },
  ];

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          bgcolor: ui.panelSolid,
          color: theme.palette.text.primary,
          backgroundImage: 'none',
          borderTop: '1px solid',
          borderColor: ui.borderSoft,
          pb: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
        },
      }}
    >
      <Box sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
        <Box
          aria-hidden
          sx={{
            width: 36,
            height: 4,
            borderRadius: 99,
            bgcolor: alpha(theme.palette.text.primary, 0.18),
            mx: 'auto',
            mb: 1,
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>
            Дополнительно
          </Typography>
          <Button
            size="small"
            onClick={() => {
              onClose();
              onClearSelection();
            }}
            sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0 }}
          >
            Снять выбор
          </Button>
        </Box>

        <List dense disablePadding data-testid="database-bulk-mobile-more-list">
          {maintenanceItems.map((item) => (
            <ListItemButton
              key={item.key}
              disabled={item.disabled}
              onClick={() => runAndClose(item.onClick)}
              sx={{
                borderRadius: 1.5,
                mb: 0.35,
                minHeight: 44,
                bgcolor: alpha(theme.palette.text.primary, 0.03),
                '&.Mui-disabled': { opacity: 0.45 },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ fontWeight: 700, fontSize: '0.88rem' }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Drawer>
  );
}

function DatabaseBulkMobileBar({
  theme,
  ui,
  selectedItemsCount,
  selectedVisibleCount,
  selectedHiddenCount,
  capabilities,
  onClearSelection,
  onOpenLocationTransfer,
  onOpenTransfer,
  onOpenTransferAct,
  onOpenCartridge,
  onOpenBattery,
  onOpenComponent,
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const handleOpenComponent = useCallback(() => {
    const kind = capabilities.componentKind || 'printer';
    const options = kind === 'pc' ? PC_COMPONENT_OPTIONS : PRINTER_COMPONENT_OPTIONS;
    onOpenComponent({
      componentKind: kind,
      componentType: options[0]?.value,
    });
  }, [capabilities.componentKind, onOpenComponent]);

  const countLabel = selectedHiddenCount > 0
    ? `${selectedVisibleCount}/${selectedItemsCount}`
    : String(selectedItemsCount);

  return (
    <>
      <Slide appear direction="up" in mountOnEnter unmountOnExit>
        <Paper
          elevation={8}
          data-testid="database-bulk-action-bar"
          data-variant="mobile"
          sx={{
            position: 'fixed',
            bottom: `calc(var(--app-shell-mobile-bottom-nav-height, 64px) + env(safe-area-inset-bottom, 0px) + ${MOBILE_BAR_GAP}px)`,
            left: 10,
            right: 10,
            zIndex: 1200,
            height: MOBILE_BAR_HEIGHT,
            px: 0.75,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            borderRadius: 2.5,
            backgroundColor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.94 : 0.97),
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            color: theme.palette.text.primary,
            border: '1px solid',
            borderColor: alpha(ui.borderSoft, 0.9),
            boxShadow: theme.palette.mode === 'dark'
              ? '0 8px 28px rgba(0,0,0,0.45)'
              : '0 8px 24px rgba(15, 23, 42, 0.12)',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.35,
              flexShrink: 0,
              pr: 0.5,
              mr: 0.25,
              borderRight: '1px solid',
              borderColor: alpha(ui.borderSoft, 0.8),
            }}
          >
            <Box
              sx={{
                minWidth: 28,
                height: 28,
                px: 0.75,
                borderRadius: 99,
                display: 'grid',
                placeItems: 'center',
                bgcolor: theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
                fontWeight: 800,
                fontSize: '0.78rem',
                lineHeight: 1,
              }}
              aria-label={`Выбрано: ${selectedItemsCount}`}
            >
              {countLabel}
            </Box>
            <IconButton
              onClick={onClearSelection}
              aria-label="Очистить выбор"
              size="small"
              sx={{
                width: 28,
                height: 28,
                borderRadius: 1.25,
                color: theme.palette.text.secondary,
                bgcolor: alpha(theme.palette.text.primary, 0.05),
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flex: 1,
              minWidth: 0,
              gap: 0.15,
            }}
          >
            <DatabaseBulkMobileActionButton
              icon={<MyLocationOutlinedIcon />}
              label="Перемещ."
              onClick={onOpenLocationTransfer}
              theme={theme}
              ui={ui}
            />
            <DatabaseBulkMobileActionButton
              icon={<SwapHorizRoundedIcon />}
              label="С актом"
              onClick={onOpenTransfer}
              theme={theme}
              ui={ui}
            />
            <DatabaseBulkMobileActionButton
              icon={<AssignmentOutlinedIcon />}
              label="Акт"
              onClick={onOpenTransferAct}
              theme={theme}
              ui={ui}
            />
            <DatabaseBulkMobileActionButton
              icon={<MoreHorizRoundedIcon />}
              label="Ещё"
              onClick={() => setMoreOpen(true)}
              theme={theme}
              ui={ui}
            />
          </Box>
        </Paper>
      </Slide>

      <DatabaseBulkMobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        theme={theme}
        ui={ui}
        capabilities={capabilities}
        onOpenCartridge={onOpenCartridge}
        onOpenBattery={onOpenBattery}
        onOpenComponent={handleOpenComponent}
        onClearSelection={onClearSelection}
      />
    </>
  );
}

function DatabaseBulkActionBar({
  theme,
  ui,
  variant = 'desktop',
  selectedItemsCount = 0,
  selectedVisibleCount = 0,
  selectedHiddenCount = 0,
  selectedItemsCapabilities = defaultCapabilities,
  onClearSelection = noop,
  onOpenLocationTransfer = noop,
  onOpenTransfer = noop,
  onOpenTransferAct = noop,
  onOpenCartridge = noop,
  onOpenBattery = noop,
  onOpenComponent = noop,
}) {
  const capabilities = { ...defaultCapabilities, ...selectedItemsCapabilities };
  const isMobile = variant === 'mobile';

  const handleOpenComponent = useCallback(() => {
    const kind = capabilities.componentKind || 'printer';
    const options = kind === 'pc' ? PC_COMPONENT_OPTIONS : PRINTER_COMPONENT_OPTIONS;
    onOpenComponent({
      componentKind: kind,
      componentType: options[0]?.value,
    });
  }, [capabilities.componentKind, onOpenComponent]);

  if (isMobile) {
    return (
      <DatabaseBulkMobileBar
        theme={theme}
        ui={ui}
        selectedItemsCount={selectedItemsCount}
        selectedVisibleCount={selectedVisibleCount}
        selectedHiddenCount={selectedHiddenCount}
        capabilities={capabilities}
        onClearSelection={onClearSelection}
        onOpenLocationTransfer={onOpenLocationTransfer}
        onOpenTransfer={onOpenTransfer}
        onOpenTransferAct={onOpenTransferAct}
        onOpenCartridge={onOpenCartridge}
        onOpenBattery={onOpenBattery}
        onOpenComponent={onOpenComponent}
      />
    );
  }

  const actionButtons = (
    <>
      <Tooltip
        title="Меняет только филиал и локацию в базе. Сотрудник и акты не меняются."
        arrow
        describeChild
      >
        <Button
          size="small"
          variant="outlined"
          color="primary"
          sx={getOfficeQuietActionSx(ui, theme, 'primary')}
          onClick={onOpenLocationTransfer}
        >
          Перемещение
        </Button>
      </Tooltip>
      <Tooltip
        title="Меняет сотрудника/филиал/локацию, создаёт акт и напоминание на загрузку подписанного акта."
        arrow
        describeChild
      >
        <Button
          size="small"
          variant="outlined"
          color="primary"
          sx={getOfficeQuietActionSx(ui, theme, 'primary')}
          onClick={onOpenTransfer}
        >
          Перемещение с актом
        </Button>
      </Tooltip>
      <Tooltip
        title="Создаёт акт по выбранной технике без изменения данных в базе."
        arrow
        describeChild
      >
        <Button
          size="small"
          variant="outlined"
          color="primary"
          sx={getOfficeQuietActionSx(ui, theme, 'primary')}
          onClick={onOpenTransferAct}
        >
          Акт без перемещения
        </Button>
      </Tooltip>
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
    </>
  );

  return (
    <Paper
      elevation={3}
      data-testid="database-bulk-action-bar"
      data-variant={variant}
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
      {actionButtons}
      <IconButton
        onClick={onClearSelection}
        aria-label="Очистить выбор"
        size="small"
        sx={getOfficeQuietActionSx(ui, theme)}
      >
        <CloseRoundedIcon />
      </IconButton>
    </Paper>
  );
}

export { MOBILE_BAR_GAP, MOBILE_BAR_HEIGHT };
export default memo(DatabaseBulkActionBar);
