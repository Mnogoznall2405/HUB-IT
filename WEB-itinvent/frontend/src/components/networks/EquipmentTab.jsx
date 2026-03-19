import React, { useCallback, useMemo } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import SaveIcon from '@mui/icons-material/Save';
import WebAssetIcon from '@mui/icons-material/WebAsset';
import {
  buildOfficeUiTokens,
  getOfficeActionTraySx,
  getOfficeDrawerPaperSx,
  getOfficeEmptyStateSx,
  getOfficeHeaderBandSx,
  getOfficeListRowSx,
  getOfficePanelSx,
  getOfficeQuietActionSx,
} from '../../theme/officeUiTokens';
import { useVirtualizedTableWindow } from './useVirtualizedTableWindow';

const COL = {
  asw: { w: 120, label: 'ASW' },
  port: { w: 90, label: 'PORT' },
  pp: { w: 90, label: 'PORT P/P' },
  location: { w: 160, label: 'Помещение' },
  vlan: { w: 65, label: 'VLAN' },
  name: { w: 200, label: 'Имя устройства' },
  ip: { w: 135, label: 'IP-адрес' },
  mac: { w: 160, label: 'MAC-адрес' },
  fio: { w: 200, label: 'ФИО' },
  actions: { w: 80, label: '' },
};

const TOTAL_W = Object.values(COL).reduce((sum, col) => sum + col.w, 0);
const TABLE_VIRTUALIZE_THRESHOLD = 120;
const TABLE_OVERSCAN_PX = 360;
const LINE_H = 24;
const ROW_PAD = 20;
const MIN_ROW_H = 48;
const CELL_PAD_X = 24;
const MONO_CHAR_W = 7.5;
const TEXT_CHAR_W = 8;
const TABLE_CONTAINER_MAX_HEIGHT = {
  xs: 'min(60vh, 520px)',
  md: 'calc(100vh - 320px)',
};

function splitValues(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\n|(?:\s{2,})/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitBySpace(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function estimateVisualLines(values, colWidth, charWidth) {
  if (!values.length) return 1;
  const charsPerLine = Math.max(1, Math.floor((colWidth - CELL_PAD_X) / charWidth));
  return values.reduce((total, value) => total + Math.max(1, Math.ceil(value.length / charsPerLine)), 0);
}

function resolveColumnWidth(columnWidths, key) {
  const value = columnWidths?.[key];
  return Number(value?.w || value || 0);
}

function calcRowHeight(port, columnWidths) {
  const ipLines = estimateVisualLines(splitBySpace(port.endpoint_ip_raw), resolveColumnWidth(columnWidths, 'ip'), MONO_CHAR_W);
  const macLines = estimateVisualLines(splitBySpace(port.endpoint_mac_raw), resolveColumnWidth(columnWidths, 'mac'), MONO_CHAR_W);
  const nameLines = estimateVisualLines(splitBySpace(port.endpoint_name_raw), resolveColumnWidth(columnWidths, 'name'), TEXT_CHAR_W);
  const fioLines = estimateVisualLines(splitValues(port.fio), resolveColumnWidth(columnWidths, 'fio'), TEXT_CHAR_W);
  return Math.max(MIN_ROW_H, Math.max(ipLines, macLines, nameLines, fioLines, 1) * LINE_H + ROW_PAD);
}

function MonoLine({ value }) {
  if (!value) return null;
  return (
    <Typography
      variant="body2"
      sx={{
        fontFamily: 'monospace',
        fontSize: '0.78rem',
        lineHeight: `${LINE_H}px`,
        wordBreak: 'break-all',
      }}
    >
      {value}
    </Typography>
  );
}

function TextLine({ value, bold = false, color }) {
  if (!value) return null;
  return (
    <Typography
      variant="body2"
      sx={{
        fontWeight: bold ? 600 : 400,
        fontSize: '0.875rem',
        lineHeight: `${LINE_H}px`,
        color,
        wordBreak: 'break-word',
      }}
    >
      {value}
    </Typography>
  );
}

export default function EquipmentTab({
  isMobile,
  canEdit,
  isBranchWidePortSearch,
  selectedBranch,
  devices,
  devicePortCounts,
  selectedDeviceId,
  selectedDevice,
  matchedDeviceIds,
  matchedDevicePortCount,
  portSearch,
  setPortSearch,
  displayedPorts,
  branchPortLoading,
  editingPortId,
  portDraft,
  portSaving,
  socketAutocompleteOpen,
  setSocketAutocompleteOpen,
  socketAutocompleteOptions,
  socketKey,
  openCreateDeviceDialog,
  openEditDeviceDialog,
  setSelectedDeviceId,
  setDeviceChipRef,
  handlePortRowClick,
  startEditPort,
  cancelEditPort,
  updatePortDraftField,
  savePortEdit,
  setSelectedSocketId,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const tableMinWidth = canEdit ? TOTAL_W : TOTAL_W - COL.actions.w;
  const visibleColumnCount = canEdit ? Object.keys(COL).length : Object.keys(COL).length - 1;
  const useVirtualization = displayedPorts.length >= TABLE_VIRTUALIZE_THRESHOLD;

  const handleExportCSV = useCallback(() => {
    if (!displayedPorts?.length) return;
    const headers = ['ASW', 'PORT', 'PORT P/P', 'Помещение', 'VLAN', 'Имя устройства', 'IP', 'MAC', 'ФИО'];
    const rows = displayedPorts.map((port) => [
      port.device_code || selectedDevice?.device_code || '',
      port.port_name || '',
      port.patch_panel_port || '',
      port.location_code || '',
      port.vlan_raw || '',
      port.endpoint_name_raw || '',
      port.endpoint_ip_raw || '',
      port.endpoint_mac_raw || '',
      port.fio || '',
    ]);
    const csv = `data:text/csv;charset=utf-8,\uFEFF${[headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n')}`;
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `Порты_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [displayedPorts, selectedDevice]);

  const rowHeights = useMemo(() => displayedPorts.map((port) => calcRowHeight(port, COL)), [displayedPorts]);
  const {
    containerRef,
    handleScroll,
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
  } = useVirtualizedTableWindow({
    itemHeights: rowHeights,
    enabled: useVirtualization,
    overscanPx: TABLE_OVERSCAN_PX,
  });

  const visiblePorts = useMemo(
    () => (useVirtualization ? displayedPorts.slice(startIndex, endIndex) : displayedPorts),
    [displayedPorts, endIndex, startIndex, useVirtualization],
  );

  const baseHeadCellSx = {
    py: 1,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'text.secondary',
    fontSize: '0.68rem',
    borderBottomColor: ui.borderStrong,
    bgcolor: ui.headerBandBg,
  };

  const baseBodyCellSx = {
    px: 1.5,
    py: 0.75,
    verticalAlign: 'top',
    borderBottomColor: ui.borderSoft,
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
        <Paper elevation={0} sx={getOfficePanelSx(ui, { width: '100%', flexShrink: 0, p: 1.5, display: 'flex', flexDirection: 'column' })}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
            <Typography variant="subtitle2">Оборудование ({devices.length})</Typography>
            {canEdit && (
              <Button
                variant="outlined"
                size="small"
                onClick={openCreateDeviceDialog}
                startIcon={<AddIcon />}
                sx={getOfficeQuietActionSx(ui, theme, 'primary')}
              >
                Добавить
              </Button>
            )}
          </Stack>
          <Box>
            {devices.length === 0 ? (
              <Box sx={getOfficeEmptyStateSx(ui, { p: 1.2 })}>
                <Typography variant="body2" color="text.secondary">Нет устройств.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', overflowX: 'auto', gap: 0.8, pb: 0.5 }}>
                <Chip
                  label="Все устройства"
                  variant={selectedDeviceId === null ? 'filled' : 'outlined'}
                  color={selectedDeviceId === null ? 'primary' : 'default'}
                  onClick={() => setSelectedDeviceId(null)}
                  sx={{ borderRadius: 1 }}
                />
                {devices.map((device) => {
                  const isSelected = selectedDeviceId === device.id;
                  const portCount = devicePortCounts.get(device.id) || 0;
                  const label = `${device.device_code} (${portCount})`;
                  const isMatched = isBranchWidePortSearch && matchedDeviceIds.has(device.id);
                  const matchCount = matchedDevicePortCount.get(device.id) || 0;

                  let chipColor = 'default';
                  if (isSelected) chipColor = 'primary';
                  else if (isMatched) chipColor = 'warning';

                  return (
                    <Chip
                      key={device.id}
                      label={isMatched && !isSelected ? `${label} [найдено: ${matchCount}]` : label}
                      variant={isSelected ? 'filled' : 'outlined'}
                      color={chipColor}
                      onClick={() => setSelectedDeviceId(device.id)}
                      ref={(node) => setDeviceChipRef?.(device.id, node)}
                      sx={{ borderRadius: 1 }}
                    />
                  );
                })}
              </Box>
            )}
          </Box>
        </Paper>

        <Box sx={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Paper elevation={0} sx={getOfficeActionTraySx(ui, { p: 1.2, mb: 1, display: 'flex', alignItems: 'center', gap: 1 })}>
            <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap', minWidth: 100 }}>
              {selectedDeviceId === null ? 'Все порты' : `Порты: ${selectedDevice?.device_code || ''}`}
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder="Поиск: ASW / PORT / розетка / IP / MAC / Имя / ФИО"
              value={portSearch}
              onChange={(event) => setPortSearch(event.target.value)}
              sx={{ bgcolor: ui.actionBg }}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleExportCSV}
              sx={{ ...getOfficeQuietActionSx(ui, theme), whiteSpace: 'nowrap' }}
              disabled={!displayedPorts?.length}
            >
              CSV ({displayedPorts?.length || 0})
            </Button>
            {canEdit && selectedDeviceId !== null && (
              <Button
                variant="outlined"
                size="small"
                onClick={() => openEditDeviceDialog(selectedDevice)}
                startIcon={<EditIcon />}
                sx={getOfficeQuietActionSx(ui, theme, 'primary')}
              >
                Изменить
              </Button>
            )}
          </Paper>

          <Paper
            elevation={0}
            sx={getOfficePanelSx(ui, {
              flexGrow: 1,
              mb: 1,
              pb: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            })}
          >
            {branchPortLoading ? (
              <Box sx={{ p: 2 }}>
                <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 2, textAlign: 'center' }) }}>
                  <Typography variant="body2" color="text.secondary">Загрузка портов...</Typography>
                </Box>
              </Box>
            ) : displayedPorts.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 2, textAlign: 'center' }) }}>
                  <Typography variant="body2" color="text.secondary">Порты не найдены.</Typography>
                </Box>
              </Box>
            ) : (
              <TableContainer
                ref={containerRef}
                onScroll={handleScroll}
                sx={{
                  flexGrow: 1,
                  minHeight: 0,
                  maxHeight: TABLE_CONTAINER_MAX_HEIGHT,
                  overflowY: 'scroll',
                  overflowX: 'auto',
                  scrollbarGutter: 'stable both-edges',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <Table stickyHeader size="small" sx={{ minWidth: tableMinWidth, width: `max(100%, ${tableMinWidth}px)`, tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.asw.w }}>ASW</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.port.w }}>PORT</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.pp.w }}>PORT P/P</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.location.w }}>Помещение</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.vlan.w }}>VLAN</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.name.w }}>Имя устройства</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.ip.w }}>IP-адрес</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.mac.w }}>MAC-адрес</TableCell>
                      <TableCell sx={{ ...baseHeadCellSx, width: COL.fio.w }}>ФИО</TableCell>
                      {canEdit && <TableCell sx={{ ...baseHeadCellSx, width: COL.actions.w }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {useVirtualization && topSpacerHeight > 0 && (
                      <TableRow>
                        <TableCell colSpan={visibleColumnCount} sx={{ p: 0, borderBottom: 'none', height: topSpacerHeight }} />
                      </TableRow>
                    )}

                    {visiblePorts.map((port) => {
                      const isEditing = Number(editingPortId) === Number(port.id);
                      const ips = splitBySpace(port.endpoint_ip_raw);
                      const macs = splitBySpace(port.endpoint_mac_raw);
                      const names = splitBySpace(port.endpoint_name_raw);
                      const fios = splitValues(port.fio);

                      return (
                        <TableRow
                          key={port.id}
                          hover
                          selected={isEditing}
                          onClick={(event) => handlePortRowClick(port, event)}
                          sx={{
                            cursor: 'pointer',
                            ...getOfficeListRowSx(ui, theme, {
                              selected: isEditing,
                              accentColor: theme.palette.primary.main,
                            }),
                          }}
                        >
                          <TableCell sx={baseBodyCellSx}><TextLine bold value={port.device_code || selectedDevice?.device_code || '-'} /></TableCell>
                          <TableCell sx={baseBodyCellSx}><MonoLine value={port.port_name || '-'} /></TableCell>
                          <TableCell sx={baseBodyCellSx}><TextLine bold color="primary.main" value={port.patch_panel_port || '-'} /></TableCell>
                          <TableCell sx={baseBodyCellSx}><TextLine value={port.location_code || '-'} /></TableCell>
                          <TableCell sx={baseBodyCellSx}><TextLine color={port.vlan_raw ? 'text.secondary' : undefined} value={port.vlan_raw || '-'} /></TableCell>
                          <TableCell sx={baseBodyCellSx}>
                            {names.length > 0 ? names.map((name) => <TextLine key={`${port.id}-name-${name}`} value={name} />) : <TextLine value="-" />}
                          </TableCell>
                          <TableCell sx={baseBodyCellSx}>
                            {ips.length > 0 ? ips.map((ip) => <MonoLine key={`${port.id}-ip-${ip}`} value={ip} />) : <MonoLine value="-" />}
                          </TableCell>
                          <TableCell sx={baseBodyCellSx}>
                            {macs.length > 0 ? macs.map((mac) => <MonoLine key={`${port.id}-mac-${mac}`} value={mac} />) : <MonoLine value="-" />}
                          </TableCell>
                          <TableCell sx={baseBodyCellSx}>
                            {fios.length > 0 ? fios.map((fio) => <TextLine key={`${port.id}-fio-${fio}`} value={fio} />) : <TextLine value="-" />}
                          </TableCell>
                          {canEdit && (
                            <TableCell align="center" sx={{ ...baseBodyCellSx, width: COL.actions.w }}>
                              <Tooltip title="Изменить порт">
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startEditPort(port, event);
                                  }}
                                >
                                  <EditIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}

                    {useVirtualization && bottomSpacerHeight > 0 && (
                      <TableRow>
                        <TableCell colSpan={visibleColumnCount} sx={{ p: 0, borderBottom: 'none', height: bottomSpacerHeight }} />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Box>
      </Box>

      <Drawer
        anchor="right"
        open={Boolean(editingPortId) && Boolean(portDraft)}
        onClose={cancelEditPort}
        PaperProps={{
          sx: getOfficeDrawerPaperSx(ui, {
            width: { xs: '100%', sm: 420 },
            p: 0,
          }),
        }}
      >
        {portDraft && (() => {
          const editPort = displayedPorts.find((port) => Number(port.id) === Number(editingPortId));
          if (!editPort) return null;

          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <Box sx={getOfficeHeaderBandSx(ui, { px: 3, py: 2 })}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography variant="h6" fontWeight={700}>Редактирование порта</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {editPort.device_code || selectedDevice?.device_code || '-'} · {editPort.port_name || '-'}
                    </Typography>
                  </Box>
                  <IconButton onClick={cancelEditPort}>
                    <CloseIcon />
                  </IconButton>
                </Stack>
              </Box>

              <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: ui.panelSolid }}>
                <Box>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Розетка (PORT P/P)
                  </Typography>
                  <Autocomplete
                    size="small"
                    fullWidth
                    freeSolo
                    open={socketAutocompleteOpen}
                    onOpen={() => setSocketAutocompleteOpen(true)}
                    onClose={() => setSocketAutocompleteOpen(false)}
                    options={socketAutocompleteOptions}
                    getOptionLabel={(option) => String(option?.socket_code || option || '')}
                    groupBy={(option) => String(option?.location_code || 'Без помещения')}
                    value={
                      socketAutocompleteOptions.find(
                        (option) => socketKey(option.socket_code) === socketKey(portDraft?.patch_panel_port || ''),
                      ) || portDraft?.patch_panel_port || ''
                    }
                    onChange={(_, value) => {
                      updatePortDraftField('patch_panel_port', String(value?.socket_code || value || ''));
                      setSelectedSocketId(value?.id || null);
                    }}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Например: 6/46" />
                    )}
                    renderOption={(props, option) => {
                      const { key, ...otherProps } = props;
                      const isPlaced = Number(option.map_id || 0) > 0;

                      return (
                        <Box
                          key={key}
                          component="li"
                          {...otherProps}
                          sx={{
                            ...getOfficeListRowSx(ui, theme, { borderBottom: true, interactive: true }),
                            display: 'flex',
                            alignItems: 'center',
                            py: 1,
                            gap: 1.5,
                            '&:last-child': { borderBottom: 'none' },
                          }}
                        >
                          <Chip
                            label={option.socket_code}
                            size="small"
                            color="primary"
                            variant="outlined"
                            sx={{ fontWeight: 700, minWidth: 60, fontFamily: 'monospace' }}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }} noWrap>
                              <LocationOnIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              {option.location_code || 'Без помещения'}
                            </Typography>
                            {(option.endpoint_name_raw || option.fio) && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                                {option.fio ? `ФИО: ${option.fio}` : option.endpoint_name_raw}
                              </Typography>
                            )}
                          </Box>
                          {isPlaced && (
                            <Tooltip title="Размещена на карте">
                              <WebAssetIcon sx={{ fontSize: 16, color: 'success.main', opacity: 0.8 }} />
                            </Tooltip>
                          )}
                        </Box>
                      );
                    }}
                    renderGroup={(params) => (
                      <li key={params.key}>
                        <Typography variant="overline" sx={{ px: 2, pt: 1, pb: 0.5, display: 'block', bgcolor: ui.headerBandBg, color: ui.mutedText, fontWeight: 700, lineHeight: 1.2 }}>
                          {params.group}
                        </Typography>
                        <ul>{params.children}</ul>
                      </li>
                    )}
                    ListboxProps={{ sx: { maxHeight: 320, p: 0 } }}
                  />
                </Box>

                <Box>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Помещение
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={portDraft?.location_code || ''}
                    onChange={(event) => updatePortDraftField('location_code', event.target.value)}
                    placeholder="Номер помещения"
                  />
                </Box>

                <Box>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    VLAN
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={portDraft?.vlan_raw || ''}
                    onChange={(event) => updatePortDraftField('vlan_raw', event.target.value)}
                    placeholder="Номер VLAN"
                  />
                </Box>

                <Divider />

                <Box>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Имя устройства (каждое имя с новой строки)
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={6}
                    value={portDraft?.endpoint_name_raw || ''}
                    onChange={(event) => updatePortDraftField('endpoint_name_raw', event.target.value)}
                    placeholder={'TMN-FIN-0029\nTMN-FIN-0024'}
                    sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                  />
                </Box>

                <Box>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    IP-адрес (каждый IP с новой строки)
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={6}
                    value={portDraft?.endpoint_ip_raw || ''}
                    onChange={(event) => updatePortDraftField('endpoint_ip_raw', event.target.value)}
                    placeholder={'10.105.1.75\n10.105.1.74'}
                    sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                  />
                </Box>

                <Box>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    MAC-адрес (каждый MAC с новой строки)
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={6}
                    value={portDraft?.endpoint_mac_raw || ''}
                    onChange={(event) => updatePortDraftField('endpoint_mac_raw', event.target.value)}
                    placeholder={'AA:BB:CC:DD:EE:FF\nAA-BB-CC-DD-EE-FF'}
                    helperText="По одному MAC на строку. Допустимы ':' и '-'."
                    sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                  />
                </Box>

                <Divider />
              </Box>

              <Box sx={getOfficeHeaderBandSx(ui, { px: 3, py: 2, borderTop: '1px solid', borderTopColor: ui.borderSoft, borderBottom: 'none' })}>
                <Stack direction="row" spacing={1.5}>
                  <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    disabled={portSaving}
                    onClick={(event) => savePortEdit(editPort, event)}
                    startIcon={<SaveIcon />}
                  >
                    {portSaving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                  <Button
                    variant="outlined"
                    fullWidth
                    size="large"
                    onClick={cancelEditPort}
                    startIcon={<CloseIcon />}
                    sx={getOfficeQuietActionSx(ui, theme)}
                  >
                    Отмена
                  </Button>
                </Stack>
              </Box>
            </Box>
          );
        })()}
      </Drawer>
    </>
  );
}
