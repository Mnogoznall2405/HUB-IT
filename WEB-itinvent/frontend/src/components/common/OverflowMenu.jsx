import { memo, useCallback, useState } from 'react';
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';

function OverflowMenu({
  items = [],
  onSelect,
  label = 'Действия',
  size = 'small',
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const handleOpen = useCallback((event) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback((event) => {
    event?.stopPropagation?.();
    setAnchorEl(null);
  }, []);

  const handleSelect = useCallback((event, key) => {
    event.stopPropagation();
    setAnchorEl(null);
    onSelect?.(key);
  }, [onSelect]);

  return (
    <>
      <IconButton
        size={size}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : undefined}
        onClick={handleOpen}
        sx={{
          width: size === 'medium' ? 36 : 32,
          height: size === 'medium' ? 36 : 32,
          borderRadius: 1.25,
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 180,
              backgroundImage: 'none',
            },
          },
        }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.key}
            onClick={(event) => handleSelect(event, item.key)}
            disabled={Boolean(item.disabled)}
            sx={item.tone === 'danger' ? { color: 'error.main' } : undefined}
          >
            {item.icon ? <ListItemIcon>{item.icon}</ListItemIcon> : null}
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default memo(OverflowMenu);
