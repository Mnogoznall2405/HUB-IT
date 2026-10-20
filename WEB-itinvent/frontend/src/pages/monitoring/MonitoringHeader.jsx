import { useState } from 'react';
import { Box, Chip, IconButton, InputAdornment, Menu, MenuItem, Stack, TextField, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import NetworkCheckOutlinedIcon from '@mui/icons-material/NetworkCheckOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useMainLayoutShell } from '../../components/layout/MainLayoutShellContext';
import ShellNotificationsButton from '../../components/layout/ShellNotificationsButton';

export default function MonitoringHeader({ search, filter, onSearch, onFilter, count, issues, selected, canManage, probing, deleting, searchInputRef, onBack, onRefresh, onConnect, onProbe, onSettings, onPortControl, onDelete }) {
  const shell = useMainLayoutShell();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('lg'));
  const [anchor, setAnchor] = useState(null);
  const actions = [
    { label: 'Обновить', icon: <RefreshRoundedIcon />, click: onRefresh },
    ...(canManage && selected ? [
      { label: probing ? 'Опрашиваем…' : 'Опросить', icon: <NetworkCheckOutlinedIcon />, click: onProbe, disabled: probing || deleting || !selected.enabled },
      { label: 'Настройки устройства', icon: <SettingsOutlinedIcon />, click: onSettings, disabled: deleting },
      ...(onPortControl ? [{ label: 'Контроль порта', icon: <TuneRoundedIcon />, click: onPortControl, disabled: deleting }] : []),
      { label: deleting ? 'Удаляем…' : 'Удалить устройство', icon: <DeleteOutlineRoundedIcon />, click: onDelete, disabled: probing || deleting, color: 'error' },
    ] : []),
    ...(canManage ? [{ label: 'Подключить устройство', icon: <AddRoundedIcon />, click: onConnect }] : []),
  ];
  return <Box component="header" role="banner" aria-label="Панель мониторинга" sx={{ position: 'sticky', top: 'var(--app-shell-top-offset, 0px)', zIndex: theme.zIndex.appBar - 1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', px: { xs: 1, sm: 2 }, py: 0.75 }}>
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
      <Stack direction="row" alignItems="center" gap={0.5} sx={{ minWidth: 0, flex: compact ? 1 : '0 0 auto' }}>
        {shell.sidebarPinned ? null : <IconButton aria-label="Открыть меню" onClick={shell.toggleDrawer} sx={{ width: 40, height: 40 }}><MenuRoundedIcon /></IconButton>}
        {selected && <Tooltip title="Все устройства"><IconButton aria-label="Все устройства" onClick={onBack} sx={{ width: 40, height: 40 }}><ArrowBackRoundedIcon /></IconButton></Tooltip>}
        <Typography component="h1" variant="subtitle1" fontWeight={800} noWrap sx={{ minWidth: 0 }}>Мониторинг</Typography>
        <Tooltip title={`${count} устройств · требуют внимания ${issues}`}><Chip size="small" variant="outlined" label={`${count} / ${issues}`} aria-label={`${count} устройств, требуют внимания ${issues}`} color={issues ? 'warning' : 'default'} sx={{ ml: 0.5, display: selected ? { xs: 'none', md: 'inline-flex' } : 'inline-flex', fontVariantNumeric: 'tabular-nums' }} /></Tooltip>
      </Stack>
      <Stack direction="row" gap={1} sx={{ order: compact ? 3 : 0, flex: compact ? '1 0 100%' : 1, flexWrap: 'wrap', minWidth: 0 }}>
        <TextField size="small" label="Найти оборудование" placeholder="Название или IP" value={search} onChange={(e) => onSearch(e.target.value)}
          inputRef={searchInputRef} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} sx={{ flex: '1 1 150px', minWidth: 0, '& input': { fontSize: { xs: 16, sm: 13 } } }} />
        <TextField select size="small" label="Состояние" value={filter} onChange={(e) => onFilter(e.target.value)} sx={{ flex: { xs: '1 1 130px', sm: '0 1 170px' }, minWidth: 0 }}>
          {[['all', 'Все устройства'], ['issues', 'Требуют внимания'], ['online', 'В сети'], ['offline', 'Нет связи'], ['link', 'Нет линка'], ['paused', 'Приостановлены']].map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
      </Stack>
      <Stack direction="row" gap={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
        {compact ? <><IconButton aria-label="Действия мониторинга" aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={(e) => setAnchor(e.currentTarget)} sx={{ width: 40, height: 40 }}><MoreHorizRoundedIcon /></IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>{actions.map((action) => <MenuItem key={action.label} disabled={action.disabled} onClick={() => { setAnchor(null); action.click(); }} sx={{ gap: 1.5, minHeight: 44, ...(action.color ? { color: `${action.color}.main` } : {}) }}>{action.icon}{action.label}</MenuItem>)}</Menu>
        </> : actions.map((action) => <Tooltip title={action.label} key={action.label}><span><IconButton aria-label={action.label} disabled={action.disabled} onClick={action.click} color={action.color || (action.label === 'Подключить устройство' ? 'primary' : 'default')} sx={{ width: 40, height: 40 }}>{action.icon}</IconButton></span></Tooltip>)}
        <ShellNotificationsButton />
      </Stack>
    </Stack>
  </Box>;
}
