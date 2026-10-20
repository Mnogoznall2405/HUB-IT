import { useCallback, useEffect, useState } from 'react';
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import ArrowDropUpRoundedIcon from '@mui/icons-material/ArrowDropUpRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';

// Small chevron next to the mic/camera button with the list of input devices.
// `devicesVersion` bumps when the browser reports a plugged/unplugged device.
export default function CallDeviceMenu({
  kind,
  title,
  emptyLabel,
  devicesVersion = 0,
  controls,
  disabled = false,
  testId,
  // Portal target: inside the fullscreen call panel only its own subtree is visible.
  container,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [devices, setDevices] = useState([]);
  const [activeId, setActiveId] = useState('');
  const open = Boolean(anchorEl);

  const refresh = useCallback(async () => {
    const result = await controls.listDevices(kind);
    setDevices(result.devices || []);
    setActiveId(result.activeId || '');
  }, [controls, kind]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, devicesVersion, refresh]);

  return (
    <>
      <Tooltip title={title} PopperProps={container ? { container } : undefined}>
        <span>
          <IconButton
            aria-label={title}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled}
            onClick={(event) => setAnchorEl(event.currentTarget)}
            data-testid={testId}
            sx={{
              width: 28,
              height: 28,
              ml: -0.75,
              color: '#fff',
              bgcolor: 'rgba(255,255,255,0.12)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.22)' },
              '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)' },
            }}
          >
            <ArrowDropUpRoundedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        container={container}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        data-testid={`${testId}-list`}
      >
        {devices.length === 0 ? (
          <MenuItem disabled dense>
            <ListItemText primary={emptyLabel} />
          </MenuItem>
        ) : null}
        {devices.map((device, index) => {
          const selected = device.deviceId === activeId;
          return (
            <MenuItem
              key={device.deviceId}
              selected={selected}
              data-device-id={device.deviceId}
              onClick={() => {
                setAnchorEl(null);
                void controls.selectDevice(kind, device.deviceId);
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                {selected ? <CheckRoundedIcon fontSize="small" /> : null}
              </ListItemIcon>
              <ListItemText
                primary={device.label || `Устройство ${index + 1}`}
                primaryTypographyProps={{ sx: { maxWidth: 260, overflowWrap: 'anywhere' } }}
              />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
