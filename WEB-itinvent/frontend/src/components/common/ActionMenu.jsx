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

/**
 * Action menu component for table rows
 *
 * Props:
 * - onAction: Callback when action is selected (actionType, item)
 * - actions: Array of actions to show ['view', 'location_transfer', 'transfer', 'cartridge', 'battery', 'component', 'cleaning', 'delete']
 * - item: The data item (optional, passed to onAction)
 * - label: ARIA label for the button
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
function ActionMenu({ onAction, actions = ['view'], item = null, label = 'Действия' }) {
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
        sx={{
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
        {actions.includes('view') && (
          <MenuItem onClick={() => handleAction('view')}>
            <ListItemIcon>
              <SwapHorizIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Просмотр</ListItemText>
          </MenuItem>
        )}
        {actions.includes('location_transfer') && (
          <Tooltip title="Меняет только филиал и локацию в базе. Сотрудник и акты не меняются." placement="left" arrow>
            <MenuItem onClick={() => handleAction('location_transfer')}>
              <ListItemIcon>
                <MyLocationIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Перемещение</ListItemText>
            </MenuItem>
          </Tooltip>
        )}
        {actions.includes('transfer') && (
          <Tooltip title="Меняет сотрудника/филиал/локацию, создаёт акт и напоминание на загрузку подписанного акта." placement="left" arrow>
            <MenuItem onClick={() => handleAction('transfer')}>
              <ListItemIcon>
                <SwapHorizIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Перемещение с актом</ListItemText>
            </MenuItem>
          </Tooltip>
        )}
        {(actions.includes('view') || actions.includes('location_transfer') || actions.includes('transfer')) &&
         (actions.includes('cartridge') || actions.includes('battery') || actions.includes('component') || actions.includes('cleaning')) && (
          <Divider />
        )}
        {actions.includes('cartridge') && (
          <MenuItem onClick={() => handleAction('cartridge')}>
            <ListItemIcon>
              <PrintIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Замена картриджа</ListItemText>
          </MenuItem>
        )}
        {actions.includes('battery') && (
          <MenuItem onClick={() => handleAction('battery')}>
            <ListItemIcon>
              <BatteryChargingFullIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Замена батареи</ListItemText>
          </MenuItem>
        )}
        {actions.includes('component') && (
          <MenuItem onClick={() => handleAction('component')}>
            <ListItemIcon>
              <BuildIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Замена компонента</ListItemText>
          </MenuItem>
        )}
        {actions.includes('cleaning') && (
          <MenuItem onClick={() => handleAction('cleaning')}>
            <ListItemIcon>
              <CleaningServicesIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Чистка ПК</ListItemText>
          </MenuItem>
        )}
        {actions.includes('delete') && actions.some((action) => action !== 'delete') && <Divider />}
        {actions.includes('delete') && (
          <MenuItem
            onClick={() => handleAction('delete')}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'error.main' }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Удалить</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

export default memo(ActionMenu);
