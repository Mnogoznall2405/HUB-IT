import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, IconButton, Paper, Typography, alpha } from '@mui/material';
import BatteryFullIcon from '@mui/icons-material/BatteryFull';
import CheckIcon from '@mui/icons-material/Check';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import ComputerIcon from '@mui/icons-material/DesktopWindows';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LaptopIcon from '@mui/icons-material/Laptop';
import MonitorIcon from '@mui/icons-material/DesktopMac';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PrintIcon from '@mui/icons-material/Print';
import StorageIcon from '@mui/icons-material/Storage';
import TransferIcon from '@mui/icons-material/SwapHoriz';

import { DATA_MODE_EQUIPMENT, getEquipmentRowActions, toInvNo } from './equipmentModel';
import { readFirst } from './databaseRecordModel';

const getEquipmentCardActionMeta = (action) => {
  switch (action) {
    case 'view':
      return { label: 'Подробнее', icon: <OpenInNewIcon fontSize="small" /> };
    case 'transfer':
      return { label: 'Переместить', icon: <TransferIcon fontSize="small" /> };
    case 'cartridge':
      return { label: 'Картридж', icon: <PrintIcon fontSize="small" /> };
    case 'battery':
      return { label: 'Батарея', icon: <BatteryFullIcon fontSize="small" /> };
    case 'component':
      return { label: 'Компонент', icon: <StorageIcon fontSize="small" /> };
    case 'cleaning':
      return { label: 'Чистка ПК', icon: <ComputerIcon fontSize="small" /> };
    case 'delete':
      return { label: 'Удалить', icon: <DeleteIcon fontSize="small" /> };
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

const ModernEquipmentCard = memo(function ModernEquipmentCard({
  item,
  theme,
  onAction,
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
  const dept = readFirst(item, ['OWNER_DEPT', 'employee_dept'], '');
  const status = readFirst(item, ['STATUS_DESCR', 'status_descr', 'DESCR'], '—');
  const location = readFirst(item, ['LOCATION', 'location', 'PLACE'], '');
  const typeName = readFirst(item, ['TYPE_NAME', 'type_name'], '');

  const actionButtons = useMemo(
    () => getEquipmentCardActionButtons(getEquipmentRowActions({ item, dataMode, canWrite, isAdmin })),
    [item, dataMode, canWrite, isAdmin]
  );

  const statusLower = String(status).toLowerCase();
  const statusColor = statusLower.includes('в работе') || statusLower.includes('active')
    ? 'success'
    : statusLower.includes('списан') || statusLower.includes('annulled') || statusLower.includes('списание')
      ? 'error'
      : statusLower.includes('ремонт') || statusLower.includes('repair')
        ? 'warning'
        : 'default';

  const typeLower = String(typeName).toLowerCase();
  const typeConfig = (() => {
    if (typeLower.includes('принтер') || typeLower.includes('printer') || typeLower.includes('mfp')) {
      return {
        icon: <PrintIcon sx={{ fontSize: 24 }} />,
        color: '#FF6F00',
        gradient: 'linear-gradient(135deg, rgba(255, 111, 0, 0.1), rgba(255, 111, 0, 0.03))',
        border: 'rgba(255, 111, 0, 0.2)',
      };
    }
    if (typeLower.includes('монитор') || typeLower.includes('display')) {
      return {
        icon: <MonitorIcon sx={{ fontSize: 24 }} />,
        color: '#1976D2',
        gradient: 'linear-gradient(135deg, rgba(25, 118, 210, 0.1), rgba(25, 118, 210, 0.03))',
        border: 'rgba(25, 118, 210, 0.2)',
      };
    }
    if (typeLower.includes('ноутбук') || typeLower.includes('laptop')) {
      return {
        icon: <LaptopIcon sx={{ fontSize: 24 }} />,
        color: '#2E7D32',
        gradient: 'linear-gradient(135deg, rgba(46, 125, 50, 0.1), rgba(46, 125, 50, 0.03))',
        border: 'rgba(46, 125, 50, 0.2)',
      };
    }
    if (typeLower.includes('ups') || typeLower.includes('ибп')) {
      return {
        icon: <BatteryFullIcon sx={{ fontSize: 24 }} />,
        color: '#7B1FA2',
        gradient: 'linear-gradient(135deg, rgba(123, 31, 162, 0.1), rgba(123, 31, 162, 0.03))',
        border: 'rgba(123, 31, 162, 0.2)',
      };
    }
    return {
      icon: <StorageIcon sx={{ fontSize: 24 }} />,
      color: '#757575',
      gradient: 'linear-gradient(135deg, rgba(117, 117, 117, 0.1), rgba(117, 117, 117, 0.03))',
      border: 'rgba(117, 117, 117, 0.2)',
    };
  })();

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

  const handleTouchEnd = useCallback(() => {
    setIsPressed(false);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchCancel = useCallback(() => {
    setIsPressed(false);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClick = useCallback((e) => {
    if (e.target.closest('.MuiIconButton-root') || e.target.closest('.MuiCheckbox-root')) {
      return;
    }

    if (selectionMode && onToggleSelect) {
      onToggleSelect(invNo);
    } else {
      setExpanded((prev) => !prev);
    }
  }, [selectionMode, invNo, onToggleSelect]);

  return (
    <Paper
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      sx={{
        mb: 1.5,
        borderRadius: 3,
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        background: typeConfig.gradient,
        border: isSelected ? '2px solid' : '1px solid',
        borderColor: isSelected ? theme.palette.primary.main : typeConfig.border,
        bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.04) : typeConfig.gradient,
        overflow: 'hidden',
        transform: isPressed ? 'scale(0.96)' : 'scale(1)',
        '&:active': { transform: 'scale(0.98)' },
        '&:hover': {
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        },
      }}
    >
      <Box sx={{ p: 1.75, position: 'relative' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          {onToggleSelect ? (
            <Box
              data-testid={`database-mobile-select-${invNo}`}
              aria-label={isSelected ? 'Снять выбор' : 'Выбрать'}
              role="checkbox"
              aria-checked={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(invNo);
              }}
              sx={{
                flexShrink: 0,
                width: 44,
                height: 44,
                mt: 0.25,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 10,
                borderRadius: '50%',
                border: '2px solid',
                borderColor: isSelected ? theme.palette.primary.main : alpha(theme.palette.text.secondary, 0.32),
                bgcolor: isSelected ? theme.palette.primary.main : alpha(theme.palette.background.paper, 0.86),
                color: isSelected ? theme.palette.primary.contrastText : theme.palette.text.secondary,
                boxShadow: isSelected
                  ? `0 6px 16px ${alpha(theme.palette.primary.main, 0.28)}`
                  : `0 1px 4px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.28 : 0.08)}`,
                transition: 'transform 0.16s ease, background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease',
                '&:hover': {
                  bgcolor: isSelected
                    ? theme.palette.primary.dark
                    : alpha(theme.palette.action.active, 0.08),
                },
                '&:active': {
                  transform: 'scale(0.92)',
                },
              }}
            >
              {isSelected ? (
                <CheckIcon
                  sx={{
                    fontSize: 28,
                    color: 'inherit',
                    display: 'block',
                  }}
                />
              ) : (
                <CheckBoxOutlineBlankIcon
                  sx={{
                    fontSize: 28,
                    color: 'inherit',
                    display: 'block',
                  }}
                />
              )}
            </Box>
          ) : null}

          <Box
            sx={{
              flexShrink: 0,
              width: 52,
              height: 52,
              borderRadius: 2.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(typeConfig.color, 0.12),
              color: typeConfig.color,
            }}
          >
            {typeConfig.icon}
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                lineHeight: 1.25,
                fontSize: '0.95rem',
                mb: 0.35,
              }}
            >
              {model}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  fontSize: '0.75rem',
                }}
              >
                INV: {invNo}
              </Typography>
              {serial && (
                <>
                  <Typography variant="caption" color="divider">·</Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: 'text.secondary',
                      fontSize: '0.75rem',
                    }}
                  >
                    S/N: {serial}
                  </Typography>
                </>
              )}
            </Box>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                mt: 0.25,
                fontSize: '0.75rem',
                lineHeight: 1.3,
              }}
            >
              {employee}{dept ? `, ${dept}` : ''}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
            <Chip
              label={status}
              size="small"
              color={statusColor}
              sx={{
                fontSize: '0.65rem',
                height: 22,
                fontWeight: 600,
                px: 0.5,
              }}
            />
            <IconButton
              size="small"
              onClick={handleExpandToggle}
              sx={{
                width: 32,
                height: 32,
                bgcolor: alpha(typeConfig.color, 0.08),
                color: typeConfig.color,
                transition: 'all 0.2s ease',
                '&:hover': {
                  bgcolor: alpha(typeConfig.color, 0.16),
                  transform: 'scale(1.1)',
                },
                '& .MuiSvgIcon-root': {
                  fontSize: 20,
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease',
                },
              }}
            >
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
        </Box>
      </Box>

      {expanded && (
        <Box
          sx={{
            px: 1.5,
            pb: 2,
            pt: 0.5,
            animation: 'fadeInUp 0.2s ease-out',
            '@keyframes fadeInUp': {
              from: { opacity: 0, transform: 'translateY(-8px)' },
              to: { opacity: 1, transform: 'translateY(0)' },
            },
          }}
        >
          <Box
            sx={{
              height: 1,
              background: `linear-gradient(90deg, transparent, ${alpha(typeConfig.color, 0.3)}, transparent)`,
              mb: 1.5,
            }}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {serial && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  p: 1.25,
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.04)',
                  border: '1px solid',
                  borderColor: alpha(theme.palette.info.main, 0.15),
                }}
              >
                <StorageIcon sx={{ fontSize: 18, color: theme.palette.info.main, flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Серийный номер
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      fontFamily: 'monospace',
                      color: 'text.primary',
                    }}
                  >
                    {serial}
                  </Typography>
                </Box>
              </Box>
            )}

            {location && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  p: 1.25,
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255, 152, 0, 0.08)' : 'rgba(255, 152, 0, 0.04)',
                  border: '1px solid',
                  borderColor: alpha(theme.palette.warning.main, 0.15),
                }}
              >
                <MyLocationIcon sx={{ fontSize: 18, color: theme.palette.warning.main, flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Местоположение
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      color: 'text.primary',
                    }}
                  >
                    {location}
                  </Typography>
                </Box>
              </Box>
            )}

            {dept && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  p: 1.25,
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(156, 39, 176, 0.08)' : 'rgba(156, 39, 176, 0.04)',
                  border: '1px solid',
                  borderColor: alpha('#9C27B0', 0.15),
                }}
              >
                <Box sx={{ width: 18, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <Typography sx={{ fontSize: '1rem' }}>🏢</Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Отдел
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      color: 'text.primary',
                    }}
                  >
                    {dept}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>

          {actionButtons.length > 0 && (
            <>
              <Box
                sx={{
                  height: 1,
                  background: `linear-gradient(90deg, transparent, ${alpha(typeConfig.color, 0.2)}, transparent)`,
                  my: 1.5,
                }}
              />

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 0.75,
                }}
              >
                {actionButtons.map((actionConfig) => (
                  <Button
                    key={actionConfig.action}
                    size="small"
                    startIcon={actionConfig.icon}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAction(actionConfig.action, item);
                    }}
                    variant="outlined"
                    fullWidth
                    sx={{
                      py: 1.1,
                      minHeight: 42,
                      fontSize: '0.72rem',
                      borderRadius: 1.75,
                      textTransform: 'none',
                      fontWeight: 600,
                      justifyContent: 'center',
                      px: 0.75,
                      lineHeight: 1.15,
                      whiteSpace: 'normal',
                      '& .MuiButton-startIcon': {
                        margin: 0,
                        marginRight: 0.5,
                        '& svg': {
                          fontSize: '1rem',
                        },
                      },
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                      },
                    }}
                  >
                    {actionConfig.label}
                  </Button>
                ))}
              </Box>
            </>
          )}
        </Box>
      )}

      {!expanded && (
        <Box
          sx={{
            height: 3,
            borderTop: '2px dashed',
            borderColor: alpha(typeConfig.color, 0.2),
          }}
        />
      )}
    </Paper>
  );
});

export default ModernEquipmentCard;
