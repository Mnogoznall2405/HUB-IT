import { memo } from 'react';
import {
  Box,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import UploadFileIcon from '@mui/icons-material/UploadFile';

const noop = () => {};

const iconButtonSx = {
  width: 36,
  height: 36,
  borderRadius: 1.5,
  border: '1px solid',
  borderColor: 'divider',
  flexShrink: 0,
};

function DatabaseMobileControlStrip({
  isConsumablesMode = false,
  canDatabaseWrite = false,
  branches = [],
  selectedBranch = '',
  onBranchChange = noop,
  hasExpandedVisible = false,
  onCollapseAll = noop,
  onOpenQrScanner = noop,
  onOpenUploadAct = noop,
  onOpenAddEquipment = noop,
  onOpenAddConsumable = noop,
  onOpenMore = noop,
}) {
  const branchLabel = selectedBranch || 'Все филиалы';

  return (
    <Box
      data-testid="database-mobile-control-strip"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mb: 0.75,
        position: 'sticky',
        top: 0,
        zIndex: 10,
        bgcolor: 'background.paper',
        py: 0.25,
      }}
    >
      {branches.length > 0 ? (
        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
          <Select
            id="database-mobile-strip-branch"
            value={selectedBranch}
            onChange={(event) => onBranchChange(event.target.value)}
            displayEmpty
            renderValue={() => branchLabel}
            inputProps={{ 'aria-label': 'Филиал' }}
            sx={{
              height: 36,
              borderRadius: 1.5,
              fontSize: '0.8rem',
              '& .MuiSelect-select': {
                py: 0.75,
                pr: '28px !important',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            }}
          >
            <MenuItem value="">Все филиалы</MenuItem>
            {branches.map((branch) => (
              <MenuItem key={branch.BRANCH_NO} value={branch.BRANCH_NAME}>
                {branch.BRANCH_NAME}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : null}

      {!isConsumablesMode && (
        <Tooltip title="QR Сканер">
          <IconButton size="small" aria-label="QR" onClick={onOpenQrScanner} sx={iconButtonSx}>
            <QrCodeScannerIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}

      {canDatabaseWrite && !isConsumablesMode && (
        <>
          <Tooltip title="Добавить оборудование">
            <IconButton size="small" aria-label="Добавить" onClick={onOpenAddEquipment} sx={iconButtonSx}>
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Загрузить акт">
            <IconButton size="small" aria-label="Акт" onClick={onOpenUploadAct} sx={iconButtonSx}>
              <UploadFileIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </>
      )}

      {canDatabaseWrite && isConsumablesMode && (
        <Tooltip title="Добавить расходник">
          <IconButton size="small" aria-label="Добавить" onClick={onOpenAddConsumable} sx={iconButtonSx}>
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}

      {hasExpandedVisible && (
        <Tooltip title="Свернуть разделы">
          <IconButton size="small" aria-label="Свернуть разделы" onClick={onCollapseAll} sx={iconButtonSx}>
            <ExpandMoreIcon sx={{ fontSize: 18, transform: 'rotate(180deg)' }} />
          </IconButton>
        </Tooltip>
      )}

      <Tooltip title="Ещё">
        <IconButton size="small" aria-label="Ещё" onClick={onOpenMore} sx={iconButtonSx}>
          <MoreHorizIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default memo(DatabaseMobileControlStrip);
