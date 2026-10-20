import { useState, useCallback, memo } from 'react';
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Tooltip } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import PrintIcon from '@mui/icons-material/Print';
import BatteryChargingFullIcon from '@mui/icons-material/BatteryChargingFull';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import BuildIcon from '@mui/icons-material/Build';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import RemoveDoneIcon from '@mui/icons-material/RemoveDone';

// Shared by the ⋮ trigger (ActionMenu) and the row-click menu (RowActionMenu).
// Returns an array (not a fragment) because MUI Menu needs direct children.
export function renderActionMenuItems(actions = [], handleAction) {
  const has = (name) => actions.includes(name);
  const list = [];
  if (has('view')) {
    list.push(
      <MenuItem key="view" onClick={() => handleAction('view')}>
        <ListItemIcon><SwapHorizIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Просмотр</ListItemText>
      </MenuItem>,
    );
  }
  if (has('location_transfer')) {
    list.push(
      <Tooltip key="location_transfer" title="Меняет только филиал и локацию в базе. Сотрудник и акты не меняются." placement="left" arrow>
        <MenuItem onClick={() => handleAction('location_transfer')}>
          <ListItemIcon><MyLocationIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Перемещение</ListItemText>
        </MenuItem>
      </Tooltip>,
    );
  }
  if (has('transfer')) {
    list.push(
      <Tooltip key="transfer" title="Меняет сотрудника/филиал/локацию, создаёт акт и напоминание на загрузку подписанного акта." placement="left" arrow>
        <MenuItem onClick={() => handleAction('transfer')}>
          <ListItemIcon><SwapHorizIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Перемещение с актом</ListItemText>
        </MenuItem>
      </Tooltip>,
    );
  }
  if ((has('view') || has('location_transfer') || has('transfer'))
    && (has('cartridge') || has('battery') || has('component') || has('cleaning'))) {
    list.push(<Divider key="divider-maintenance" />);
  }
  if (has('cartridge')) {
    list.push(
      <MenuItem key="cartridge" onClick={() => handleAction('cartridge')}>
        <ListItemIcon><PrintIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Замена картриджа</ListItemText>
      </MenuItem>,
    );
  }
  if (has('battery')) {
    list.push(
      <MenuItem key="battery" onClick={() => handleAction('battery')}>
        <ListItemIcon><BatteryChargingFullIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Замена батареи</ListItemText>
      </MenuItem>,
    );
  }
  if (has('component')) {
    list.push(
      <MenuItem key="component" onClick={() => handleAction('component')}>
        <ListItemIcon><BuildIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Замена компонента</ListItemText>
      </MenuItem>,
    );
  }
  if (has('cleaning')) {
    list.push(
      <MenuItem key="cleaning" onClick={() => handleAction('cleaning')}>
        <ListItemIcon><CleaningServicesIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Чистка ПК</ListItemText>
      </MenuItem>,
    );
  }
  if (has('one_c_mark')) {
    list.push(
      <Tooltip key="one_c_mark" title="Ручная отметка: оборудование сверено с 1С. Автоматическую сверку не меняет." placement="left" arrow>
        <MenuItem onClick={() => handleAction('one_c_mark')}>
          <ListItemIcon><TaskAltIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Отметить сверку с 1С</ListItemText>
        </MenuItem>
      </Tooltip>,
    );
  }
  if (has('one_c_unmark')) {
    list.push(
      <Tooltip key="one_c_unmark" title="Убрать ручную отметку; снова действует автоматическая сверка." placement="left" arrow>
        <MenuItem onClick={() => handleAction('one_c_unmark')}>
          <ListItemIcon><RemoveDoneIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Снять отметку 1С</ListItemText>
        </MenuItem>
      </Tooltip>,
    );
  }
  if (has('delete') && actions.some((action) => action !== 'delete')) {
    list.push(<Divider key="divider-delete" />);
  }
  if (has('delete')) {
    list.push(
      <MenuItem key="delete" onClick={() => handleAction('delete')} sx={{ color: 'error.main' }}>
        <ListItemIcon sx={{ color: 'error.main' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Удалить</ListItemText>
      </MenuItem>,
    );
  }
  return list;
}

/**
 * Action menu component for table rows
 *
 * Props:
 * - onAction: Callback when action is selected (actionType, item)
 * - actions: Array of actions to show ['view', 'location_transfer', 'transfer', 'cartridge', 'battery', 'component', 'cleaning', 'delete']
 * - item: The data item (optional, passed to onAction)
 * - label: ARIA label for the button
 * - compact: 28px trigger for dense table rows
 *
 * Actions:
 * - view: Open detail modal
 * - location_transfer: Change branch/location only
 * - transfer: Transfer equipment with act
 * - cartridge: Replace cartridge
 * - battery: Replace battery
 * - component: Replace printer component
 * - cleaning: PC cleaning
 * - delete: Remove equipment card
 */
function ActionMenu({ onAction, actions = ['view'], item = null, label = 'Действия', compact = false }) {
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);

  const handleOpen = useCallback((event) => {
    event.stopPropagation();
    setAnchor(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchor(null);
  }, []);

  const handleAction = useCallback((actionType) => {
    handleClose();
    onAction(actionType, item);
  }, [onAction, item, handleClose]);

  return (
    <>
      <IconButton
        onClick={handleOpen}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        size="small"
        sx={compact ? { width: 28, height: 28 } : {
          width: 44,
          height: 44,
          '@media (min-width: 600px)': {
            width: 36,
            height: 36,
          },
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 200,
              backgroundImage: 'none',
            },
          },
        }}
      >
        {renderActionMenuItems(actions, handleAction)}
      </Menu>
    </>
  );
}

export default memo(ActionMenu);
