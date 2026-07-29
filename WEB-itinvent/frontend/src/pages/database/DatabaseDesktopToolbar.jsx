import { memo } from 'react';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import UploadFileIcon from '@mui/icons-material/UploadFile';

import {
  getOfficeActionTraySx,
  getOfficeQuietActionSx,
} from '../../theme/officeUiTokens';

const noop = () => {};

function DatabaseDesktopToolbar({
  ui,
  theme,
  isConsumablesMode = false,
  canDatabaseWrite = false,
  identifyPCLoading = false,
  onOpenQrScanner = noop,
  onIdentifyWorkspace = noop,
  onOpenUploadAct = noop,
  onOpenAddEquipment = noop,
  onOpenAddConsumable = noop,
  branches = [],
  selectedBranch = '',
  onBranchChange = noop,
  hasExpandedVisible = false,
  onCollapseAll = noop,
  trailing = null,
  sx = null,
}) {
  const secondarySx = getOfficeQuietActionSx(ui, theme, 'neutral', {
    whiteSpace: 'nowrap',
    borderRadius: '4px',
    border: 'none',
    bgcolor: 'transparent',
    px: 1,
    minHeight: 32,
    '&:hover': {
      border: 'none',
      bgcolor: ui.actionHover,
      boxShadow: 'none',
    },
  });

  const primarySx = {
    whiteSpace: 'nowrap',
    borderRadius: '4px',
    boxShadow: 'none',
    textTransform: 'none',
    minHeight: 32,
    '&:hover': { boxShadow: 'none' },
  };

  return (
    <Paper
      elevation={0}
      sx={getOfficeActionTraySx(ui, {
        p: 0.75,
        px: 1,
        mb: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        flexWrap: 'wrap',
        ...sx,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
        {!isConsumablesMode && (
          <>
            <Button
              size="small"
              variant="text"
              startIcon={<QrCodeScannerIcon />}
              onClick={onOpenQrScanner}
              sx={secondarySx}
            >
              QR Сканер
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<MyLocationIcon />}
              onClick={onIdentifyWorkspace}
              disabled={identifyPCLoading}
              sx={secondarySx}
            >
              {identifyPCLoading ? 'Определение...' : 'Определить ПК'}
            </Button>
          </>
        )}

        {canDatabaseWrite && !isConsumablesMode && (
          <Button
            size="small"
            variant="text"
            startIcon={<UploadFileIcon />}
            onClick={onOpenUploadAct}
            sx={secondarySx}
          >
            Загрузить акт
          </Button>
        )}

        {canDatabaseWrite && !isConsumablesMode && (
          <Button
            size="small"
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={onOpenAddEquipment}
            sx={primarySx}
          >
            Добавить оборудование
          </Button>
        )}

        {canDatabaseWrite && isConsumablesMode && (
          <Button
            size="small"
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={onOpenAddConsumable}
            sx={primarySx}
          >
            Добавить расходник
          </Button>
        )}
      </Box>

      {trailing ? (
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {trailing}
        </Box>
      ) : null}

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexWrap: 'wrap',
          ml: { sm: 'auto' },
        }}
      >
        {branches.length > 0 && (
          <FormControl
            size="small"
            sx={{
              minWidth: 160,
              maxWidth: 240,
              '& .MuiOutlinedInput-root': {
                borderRadius: '4px',
                bgcolor: ui.actionBg,
                height: 32,
              },
              '& .MuiInputLabel-root': {
                fontSize: '0.8125rem',
              },
            }}
          >
            <InputLabel shrink>Филиал</InputLabel>
            <Select
              value={selectedBranch}
              onChange={(event) => onBranchChange(event.target.value)}
              label="Филиал"
              displayEmpty
              renderValue={(value) => (value ? value : 'Все филиалы')}
            >
              <MenuItem value="">Все филиалы</MenuItem>
              {branches.map((branch) => (
                <MenuItem key={branch.BRANCH_NO} value={branch.BRANCH_NAME}>
                  {branch.BRANCH_NAME}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {hasExpandedVisible && (
          <Button
            size="small"
            variant="text"
            startIcon={<ExpandMoreIcon sx={{ transform: 'rotate(180deg)' }} />}
            onClick={onCollapseAll}
            sx={secondarySx}
          >
            Свернуть разделы
          </Button>
        )}
      </Box>
    </Paper>
  );
}

export default memo(DatabaseDesktopToolbar);
