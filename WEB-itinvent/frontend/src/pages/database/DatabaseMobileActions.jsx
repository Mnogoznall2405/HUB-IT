import { memo } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Drawer,
  Fab,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import UploadFileIcon from '@mui/icons-material/UploadFile';

import EnhancedFabAction from './EnhancedFabAction';
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

function DatabaseMobileActions({
  theme,
  ui,
  isConsumablesMode = false,
  canDatabaseWrite = false,
  selectedItemsCount = 0,
  selectedVisibleCount = 0,
  selectedHiddenCount = 0,
  mobileSelectionMode = false,
  fabSheetOpen = false,
  onFabSheetOpenChange = noop,
  onClearSelection = noop,
  onOpenQrScanner = noop,
  onIdentifyWorkspace = noop,
  identifyWorkspaceLoading = false,
  onOpenUploadAct = noop,
  onOpenAddEquipment = noop,
  onOpenAddConsumable = noop,
  branches = [],
  selectedBranch = '',
  onBranchChange = noop,
  canLoadMore = false,
  nextEquipmentPage = null,
  equipmentPagesTotal = 1,
  loadingMoreEquipment = false,
  onLoadMore = noop,
  hasExpandedVisible = false,
  onCollapseAll = noop,
  onEnterSelectionMode = noop,
  selectedItemsCapabilities = defaultCapabilities,
  onOpenLocationTransferForSelection = noop,
  onOpenTransferForSelection = noop,
  onOpenTransferActForSelection = noop,
  onOpenCartridgeForSelection = noop,
  onOpenBatteryForSelection = noop,
  onOpenComponentForSelection = noop,
}) {
  const hasSelection = mobileSelectionMode || selectedItemsCount > 0;
  const capabilities = { ...defaultCapabilities, ...selectedItemsCapabilities };

  const closeSheet = () => onFabSheetOpenChange(false);

  const runAndClose = (callback) => {
    callback();
    closeSheet();
  };

  const handleOpenFabSheet = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
    onFabSheetOpenChange(true);
  };

  const handleOpenComponentForSelection = () => {
    const kind = capabilities.componentKind || 'printer';
    const options = kind === 'pc' ? PC_COMPONENT_OPTIONS : PRINTER_COMPONENT_OPTIONS;
    onOpenComponentForSelection({
      componentKind: kind,
      componentType: options[0]?.value,
    });
  };

  return (
    <>
      {hasSelection ? (
        <Fab
          aria-label="Clear selection"
          color="default"
          size="small"
          onClick={onClearSelection}
          sx={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            zIndex: 1100,
            boxShadow: theme.shadows[8],
            bgcolor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            '&:hover': {
              boxShadow: theme.shadows[12],
              transform: 'scale(1.05)',
            },
            transition: 'all 0.2s ease-in-out',
          }}
        >
          <CloseIcon />
        </Fab>
      ) : (
        <Fab
          aria-label="Open actions"
          color="primary"
          size="small"
          onClick={handleOpenFabSheet}
          sx={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            zIndex: 1100,
            boxShadow: theme.shadows[8],
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
            '&:hover': {
              boxShadow: theme.shadows[12],
              transform: 'scale(1.05)',
            },
            transition: 'all 0.2s ease-in-out',
          }}
        >
          <MoreVertIcon />
        </Fab>
      )}

      <Drawer
        anchor="bottom"
        open={fabSheetOpen}
        onClose={closeSheet}
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
            maxHeight: '75vh',
            px: 2,
            pb: 4,
            pt: 1,
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.1)',
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            animation: fabSheetOpen ? 'slideIn 0.3s ease-out' : 'none',
            '@keyframes slideIn': {
              from: {
                opacity: 0,
                transform: 'translateY(20px)',
              },
              to: {
                opacity: 1,
                transform: 'translateY(0)',
              },
            },
          }}
        >
          <Box
            sx={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
              mx: 'auto',
              mb: 1.5,
              transition: 'background-color 0.2s',
            }}
          />

          <Box
            sx={{
              textAlign: 'center',
              mb: 1,
              animation: fabSheetOpen ? 'fadeInUp 0.3s ease-out 0.05s both' : 'none',
              '@keyframes fadeInUp': {
                from: { opacity: 0, transform: 'translateY(10px)' },
                to: { opacity: 1, transform: 'translateY(0)' },
              },
            }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
              Действия
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Выберите действие из списка ниже
            </Typography>
          </Box>

          {!isConsumablesMode && (
            <Box sx={{ animation: fabSheetOpen ? 'fadeInUp 0.3s ease-out 0.1s both' : 'none' }}>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  display: 'block',
                  mb: 1,
                  ml: 1,
                }}
              >
                Сканирование
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.08)' : 'rgba(25, 118, 210, 0.04)',
                  border: '1px solid',
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.15)' : 'rgba(25, 118, 210, 0.1)',
                }}
              >
                <EnhancedFabAction
                  icon={<QrCodeScannerIcon />}
                  label="QR Сканер"
                  description="Сканировать QR-код оборудования"
                  onClick={() => runAndClose(onOpenQrScanner)}
                  color="primary"
                />

                <EnhancedFabAction
                  icon={<MyLocationIcon />}
                  label="Определить ПК"
                  description="Найти компьютер по сети"
                  onClick={() => runAndClose(onIdentifyWorkspace)}
                  loading={identifyWorkspaceLoading}
                />
              </Box>
            </Box>
          )}

          {canDatabaseWrite && (
            <Box sx={{ animation: fabSheetOpen ? 'fadeInUp 0.3s ease-out 0.15s both' : 'none' }}>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  display: 'block',
                  mb: 1,
                  ml: 1,
                }}
              >
                Добавление
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(46, 125, 50, 0.08)' : 'rgba(46, 125, 50, 0.04)',
                  border: '1px solid',
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(46, 125, 50, 0.15)' : 'rgba(46, 125, 50, 0.1)',
                }}
              >
                {!isConsumablesMode && (
                  <>
                    <EnhancedFabAction
                      icon={<UploadFileIcon />}
                      label="Загрузить акт"
                      description="Импортировать акт из файла"
                      onClick={() => runAndClose(onOpenUploadAct)}
                      variant="gradient"
                    />

                    <EnhancedFabAction
                      icon={<AddIcon />}
                      label="Добавить оборудование"
                      description="Новое оборудование в базу"
                      onClick={() => runAndClose(onOpenAddEquipment)}
                      variant="contained"
                    />
                  </>
                )}

                {isConsumablesMode && (
                  <EnhancedFabAction
                    icon={<AddIcon />}
                    label="Добавить расходник"
                    description="Новый картридж или расходник"
                    onClick={() => runAndClose(onOpenAddConsumable)}
                    variant="contained"
                  />
                )}
              </Box>
            </Box>
          )}

          <Box sx={{ animation: fabSheetOpen ? 'fadeInUp 0.3s ease-out 0.2s both' : 'none' }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                color: 'text.secondary',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'block',
                mb: 1,
                ml: 1,
              }}
            >
              РЈРїСЂР°РІР»РµРЅРёРµ
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                p: 1.5,
                borderRadius: 2,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(237, 108, 2, 0.08)' : 'rgba(237, 108, 2, 0.04)',
                border: '1px solid',
                borderColor: theme.palette.mode === 'dark' ? 'rgba(237, 108, 2, 0.15)' : 'rgba(237, 108, 2, 0.1)',
              }}
            >
              {branches.length > 0 && (
                <FormControl size="small" fullWidth>
                  <InputLabel id="database-mobile-branch-label" shrink>Р¤РёР»РёР°Р»</InputLabel>
                  <Select
                    labelId="database-mobile-branch-label"
                    id="database-mobile-branch"
                    value={selectedBranch}
                    onChange={(event) => onBranchChange(event.target.value)}
                    label="Р¤РёР»РёР°Р»"
                    sx={{
                      borderRadius: 2,
                      '& .MuiSelect-select': {
                        py: 1.2,
                      },
                    }}
                  >
                    <MenuItem value="">Р’СЃРµ С„РёР»РёР°Р»С‹</MenuItem>
                    {branches.map((branch) => (
                      <MenuItem key={branch.BRANCH_NO} value={branch.BRANCH_NAME}>
                        {branch.BRANCH_NAME}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {canLoadMore && (
                <EnhancedFabAction
                  icon={loadingMoreEquipment ? <CircularProgress size={20} /> : null}
                  label="Р—Р°РіСЂСѓР·РёС‚СЊ РµС‰С‘"
                  description={loadingMoreEquipment ? 'Р—Р°РіСЂСѓР·РєР°...' : `РЎС‚СЂ. ${nextEquipmentPage}/${equipmentPagesTotal}`}
                  onClick={() => runAndClose(onLoadMore)}
                  disabled={loadingMoreEquipment}
                />
              )}

              {hasExpandedVisible && (
                <EnhancedFabAction
                  icon={<ExpandMoreIcon sx={{ transform: 'rotate(180deg)' }} />}
                  label="РЎРІРµСЂРЅСѓС‚СЊ СЂР°Р·РґРµР»С‹"
                  description="РЎРєСЂС‹С‚СЊ РІСЃРµ РѕС‚РєСЂС‹С‚С‹Рµ РіСЂСѓРїРїС‹"
                  onClick={() => runAndClose(onCollapseAll)}
                />
              )}

              <EnhancedFabAction
                icon={<Checkbox />}
                label="Р РµР¶РёРј РІС‹Р±РѕСЂР°"
                description="Р’С‹Р±СЂР°С‚СЊ РЅРµСЃРєРѕР»СЊРєРѕ СЌР»РµРјРµРЅС‚РѕРІ"
                onClick={() => runAndClose(onEnterSelectionMode)}
                variant="outlined"
              />
            </Box>
          </Box>
        </Box>
      </Drawer>

      {!isConsumablesMode && canDatabaseWrite && selectedItemsCount > 0 && (
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
            size="medium"
            variant="text"
            color="primary"
            title="Меняет только филиал и локацию в базе. Сотрудник и акты не меняются."
            onClick={onOpenLocationTransferForSelection}
          >
            Перемещение
          </Button>
          <Button
            size="medium"
            variant="text"
            color="primary"
            title="Меняет сотрудника/филиал/локацию, создаёт акт и напоминание на загрузку подписанного акта."
            onClick={onOpenTransferForSelection}
          >
            Перемещение с актом
          </Button>
          <Button
            size="medium"
            variant="text"
            color="primary"
            title="Создаёт акт по выбранной технике без изменения данных в базе."
            onClick={onOpenTransferActForSelection}
          >
            Акт без перемещения
          </Button>
          <Button
            aria-label="Картридж"
            size="medium"
            variant="text"
            color="warning"
            disabled={!capabilities.canCartridge}
            onClick={onOpenCartridgeForSelection}
          />
          <Button
            aria-label="Батарея"
            size="medium"
            variant="text"
            color="warning"
            disabled={!capabilities.canBattery}
            onClick={onOpenBatteryForSelection}
          />
          <Button
            aria-label="Компонент"
            size="medium"
            variant="text"
            color="primary"
            disabled={!capabilities.canComponent}
            onClick={handleOpenComponentForSelection}
          />
          <IconButton onClick={onClearSelection} size="medium">
            <CloseIcon />
          </IconButton>
        </Paper>
      )}
    </>
  );
}

export default memo(DatabaseMobileActions);
