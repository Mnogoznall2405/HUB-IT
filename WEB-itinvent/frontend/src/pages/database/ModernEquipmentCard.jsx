import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, IconButton, Typography, alpha } from '@mui/material';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import CheckIcon from '@mui/icons-material/Check';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ComputerIcon from '@mui/icons-material/DesktopWindows';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LaptopIcon from '@mui/icons-material/Laptop';
import MonitorIcon from '@mui/icons-material/DesktopMac';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PrintIcon from '@mui/icons-material/Print';
import StorageIcon from '@mui/icons-material/Storage';
import TransferIcon from '@mui/icons-material/SwapHoriz';

import { DATA_MODE_EQUIPMENT, getEquipmentRowActions, toInvNo } from './equipmentModel';
import { readFirst } from './databaseRecordModel';
import EmployeeNameLink from './EmployeeNameLink';

const getEquipmentCardActionMeta = (action) => {
  switch (action) {
    case 'view':
      return { label: 'Подробнее', icon: <OpenInNewIcon sx={{ fontSize: 16 }} /> };
    case 'location_transfer':
      return {
        label: 'Перемещение',
        tooltip: 'Меняет только филиал и локацию в базе. Сотрудник и акты не меняются.',
        icon: <MyLocationIcon sx={{ fontSize: 16 }} />,
      };
    case 'transfer':
      return {
        label: 'Перемещение с актом',
        tooltip: 'Меняет сотрудника/филиал/локацию, создаёт акт и напоминание на загрузку подписанного акта.',
        icon: <TransferIcon sx={{ fontSize: 16 }} />,
      };
    case 'cartridge':
      return { label: 'Картридж', icon: <PrintIcon sx={{ fontSize: 16 }} /> };
    case 'battery':
      return { label: 'Батарея', icon: <BatteryFullIcon sx={{ fontSize: 16 }} /> };
    case 'component':
      return { label: 'Компонент', icon: <StorageIcon sx={{ fontSize: 16 }} /> };
    case 'cleaning':
      return { label: 'Чистка ПК', icon: <ComputerIcon sx={{ fontSize: 16 }} /> };
    case 'delete':
      return { label: 'Удалить', icon: <DeleteIcon sx={{ fontSize: 16 }} /> };
    default:
      return null;
  }
};

export const getEquipmentCardActionButtons = (actions, { includeDelete = false } = {}) =>
  (actions || [])
    .filter((action) => typeof action === 'string' && action && (includeDelete || action !== 'delete'))
    .map((action) => {
      const meta = getEquipmentCardActionMeta(action);
      return meta ? { action, ...meta } : null;
    })
    .filter(Boolean);

const getTypeConfig = (typeName) => {
  const typeLower = String(typeName).toLowerCase();
  if (typeLower.includes('принтер') || typeLower.includes('printer') || typeLower.includes('mfp')) {
    return { icon: <PrintIcon sx={{ fontSize: 18 }} />, color: '#FF6F00' };
  }
  if (typeLower.includes('монитор') || typeLower.includes('display')) {
    return { icon: <MonitorIcon sx={{ fontSize: 18 }} />, color: '#1976D2' };
  }
  if (typeLower.includes('ноутбук') || typeLower.includes('laptop')) {
    return { icon: <LaptopIcon sx={{ fontSize: 18 }} />, color: '#2E7D32' };
  }
  if (typeLower.includes('ups') || typeLower.includes('ибп')) {
    return { icon: <BatteryFullIcon sx={{ fontSize: 18 }} />, color: '#7B1FA2' };
  }
  return { icon: <StorageIcon sx={{ fontSize: 18 }} />, color: '#757575' };
};

const getStatusColor = (status) => {
  const statusLower = String(status).toLowerCase();
  if (statusLower.includes('в работе') || statusLower.includes('active')) return 'success';
  if (statusLower.includes('списан') || statusLower.includes('annulled') || statusLower.includes('списание')) {
    return 'error';
  }
  if (statusLower.includes('ремонт') || statusLower.includes('repair')) return 'warning';
  return 'default';
};

const ModernEquipmentCard = memo(function ModernEquipmentCard({
  item,
  theme,
  onAction,
  onOpenEmployee = null,
  dataMode = DATA_MODE_EQUIPMENT,
  canWrite = true,
  isAdmin = false,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}) {
  const [expanded, setExpanded] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const longPressTimerRef = useRef(null);

  const invNo = toInvNo(item);
  const model = readFirst(item, ['MODEL_NAME', 'model_name'], '—');
  const serial = readFirst(item, ['SERIAL_NO', 'serial_no'], '');
  const employee = readFirst(item, ['OWNER_DISPLAY_NAME', 'employee_name', 'OWNER_FULLNAME'], '—');
  const employeeOwnerNo = item.EMPL_NO ?? item.empl_no ?? item.OWNER_NO ?? item.owner_no ?? null;
  const dept = readFirst(item, ['OWNER_DEPT', 'employee_dept'], '');
  const status = readFirst(item, ['STATUS_DESCR', 'status_descr', 'DESCR'], '—');
  const location = readFirst(item, ['LOCATION', 'location', 'PLACE'], '');
  const typeName = readFirst(item, ['TYPE_NAME', 'type_name'], '');

  const actionButtons = useMemo(
    () => getEquipmentCardActionButtons(getEquipmentRowActions({ item, dataMode, canWrite, isAdmin })),
    [item, dataMode, canWrite, isAdmin],
  );

  const typeConfig = useMemo(() => getTypeConfig(typeName), [typeName]);
  const statusColor = useMemo(() => getStatusColor(status), [status]);

  const metaLine = [dept, location].filter(Boolean).join(' · ');

  const handleExpandToggle = useCallback((e) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  }, []);

  const handleTouchStart = useCallback(() => {
    if (!onToggleSelect) return;
    setIsPressed(true);
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(20);
      onToggleSelect(invNo);
      setIsPressed(false);
    }, 500);
  }, [invNo, onToggleSelect]);

  const clearLongPress = useCallback(() => {
    setIsPressed(false);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClick = useCallback((e) => {
    if (e.target.closest('.MuiIconButton-root') || e.target.closest('[data-select-toggle]')) {
      return;
    }

    if (selectionMode && onToggleSelect) {
      onToggleSelect(invNo);
    } else {
      setExpanded((prev) => !prev);
    }
  }, [selectionMode, invNo, onToggleSelect]);

  return (
    <Box
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearLongPress}
      onTouchMove={clearLongPress}
      onTouchCancel={clearLongPress}
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        transform: isPressed ? 'scale(0.99)' : 'none',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          py: 0.75,
          px: 0.25,
          minHeight: 52,
        }}
      >
        {onToggleSelect && selectionMode ? (
          <Box
            data-testid={`database-mobile-select-${invNo}`}
            data-select-toggle
            aria-label={isSelected ? 'Снять выбор' : 'Выбрать'}
            role="checkbox"
            aria-checked={isSelected}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(invNo);
            }}
            sx={{
              flexShrink: 0,
              width: 32,
              height: 32,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 1,
              border: '1.5px solid',
              borderColor: isSelected ? theme.palette.primary.main : alpha(theme.palette.text.secondary, 0.35),
              bgcolor: isSelected ? theme.palette.primary.main : 'transparent',
              color: isSelected ? theme.palette.primary.contrastText : theme.palette.text.secondary,
            }}
          >
            {isSelected ? <CheckIcon sx={{ fontSize: 18 }} /> : <CheckBoxOutlineBlankIcon sx={{ fontSize: 18 }} />}
          </Box>
        ) : null}

        <Box
          sx={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 1,
            display: 'grid',
            placeItems: 'center',
            bgcolor: alpha(typeConfig.color, 0.12),
            color: typeConfig.color,
          }}
        >
          {typeConfig.icon}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                fontSize: '0.82rem',
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {invNo} · {model}
            </Typography>
          </Box>

          {(employee !== '—' || metaLine) ? (
            <Box sx={{ mt: 0.15, minWidth: 0 }}>
              {employee !== '—' ? (
                <EmployeeNameLink
                  name={employee}
                  ownerNo={employeeOwnerNo}
                  onOpenEmployee={onOpenEmployee}
                  variant="caption"
                  noWrap
                  sx={{ fontSize: '0.7rem', lineHeight: 1.25, display: 'block' }}
                />
              ) : null}
              {metaLine ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: 'block',
                    fontSize: '0.7rem',
                    lineHeight: 1.25,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {metaLine}
                </Typography>
              ) : null}
            </Box>
          ) : null}
        </Box>

        <Chip
          label={status}
          size="small"
          color={statusColor}
          sx={{
            flexShrink: 0,
            fontSize: '0.6rem',
            height: 20,
            maxWidth: 88,
            '& .MuiChip-label': {
              px: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            },
          }}
        />

        <IconButton
          size="small"
          aria-label={expanded ? 'Свернуть' : 'Развернуть'}
          onClick={handleExpandToggle}
          sx={{
            flexShrink: 0,
            width: 28,
            height: 28,
            p: 0,
            color: 'text.secondary',
          }}
        >
          {expanded ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>

      {expanded && (
        <Box sx={{ pb: 1, px: 0.25, pt: 0 }}>
          {(serial || location || dept) && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                mb: actionButtons.length > 0 ? 0.75 : 0,
                pl: onToggleSelect && selectionMode ? 5.5 : 4.75,
              }}
            >
              {serial ? (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                  S/N: <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>{serial}</Box>
                </Typography>
              ) : null}
              {location ? (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                  {location}
                </Typography>
              ) : null}
              {dept ? (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                  {dept}
                </Typography>
              ) : null}
            </Box>
          )}

          {actionButtons.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                gap: 0.5,
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                pl: onToggleSelect && selectionMode ? 5.5 : 4.75,
                pr: 0.25,
                pb: 0.25,
              }}
            >
              {actionButtons.map((actionConfig) => (
                <Button
                  key={actionConfig.action}
                  size="small"
                  startIcon={actionConfig.icon}
                  title={actionConfig.tooltip || actionConfig.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction(actionConfig.action, item);
                  }}
                  variant="outlined"
                  sx={{
                    flexShrink: 0,
                    py: 0.45,
                    px: 1,
                    minHeight: 32,
                    fontSize: '0.68rem',
                    borderRadius: 1.25,
                    textTransform: 'none',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    '& .MuiButton-startIcon': {
                      mr: 0.35,
                      ml: 0,
                    },
                  }}
                >
                  {actionConfig.label}
                </Button>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
});

export default ModernEquipmentCard;
