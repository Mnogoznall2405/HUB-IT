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
}) {
  const showManagementRow = branches.length > 0 || hasExpandedVisible;
  const buttonSx = (color) => getOfficeQuietActionSx(ui, theme, color, {
    whiteSpace: 'nowrap',
    borderRadius: '12px',
  });

  return (
    <Paper
      elevation={0}
      sx={getOfficeActionTraySx(ui, {
        p: 1.2,
        mb: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {!isConsumablesMode && (
          <>
            <Button
              size="small"
              variant="outlined"
              startIcon={<QrCodeScannerIcon />}
              onClick={onOpenQrScanner}
              sx={buttonSx('primary')}
            >
              QR Сканер
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<MyLocationIcon />}
              onClick={onIdentifyWorkspace}
              disabled={identifyPCLoading}
              sx={buttonSx('warning')}
            >
              {identifyPCLoading ? 'Определение...' : 'Определить ПК'}
            </Button>
          </>
        )}

        {canDatabaseWrite && !isConsumablesMode && (
          <>
            <Button
              size="small"
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={onOpenUploadAct}
              sx={buttonSx('primary')}
            >
              Загрузить акт
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={onOpenAddEquipment}
              sx={buttonSx('success')}
            >
              Добавить оборудование
            </Button>
          </>
        )}

        {canDatabaseWrite && isConsumablesMode && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={onOpenAddConsumable}
            sx={buttonSx('success')}
          >
            Добавить расходник
          </Button>
        )}
      </Box>

      {showManagementRow && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            pt: 1,
            borderTop: '1px solid',
            borderColor: ui.borderSoft,
          }}
        >
          {branches.length > 0 && (
            <FormControl
              size="small"
              sx={{
                minWidth: 220,
                maxWidth: 320,
                '& .MuiOutlinedInput-root': {
                  borderRadius: '12px',
                  bgcolor: ui.actionBg,
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
              variant="outlined"
              startIcon={<ExpandMoreIcon sx={{ transform: 'rotate(180deg)' }} />}
              onClick={onCollapseAll}
              sx={buttonSx('neutral')}
            >
              Свернуть разделы
            </Button>
          )}
        </Box>
      )}
    </Paper>
  );
}

export default memo(DatabaseDesktopToolbar);
