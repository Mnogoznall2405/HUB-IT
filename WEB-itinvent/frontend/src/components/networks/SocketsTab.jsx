import React, { useMemo } from 'react';
import {
  Box,
  Button,
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  buildOfficeUiTokens,
  getOfficeActionTraySx,
  getOfficeEmptyStateSx,
  getOfficeListRowSx,
  getOfficePanelSx,
} from '../../theme/officeUiTokens';
import { useVirtualizedTableWindow } from './useVirtualizedTableWindow';

const COL = {
  socket: { w: 90, label: 'Розетка' },
  asw: { w: 100, label: 'ASW' },
  port: { w: 110, label: 'PORT' },
  location: { w: 155, label: 'Помещение' },
  vlan: { w: 60, label: 'VLAN' },
  ip: { w: 145, label: 'IP' },
  mac: { w: 165, label: 'MAC' },
  name: { w: 175, label: 'Имя устройства' },
  fio: { w: 200, label: 'ФИО' },
  actions: { w: 64, label: '' },
};

const TOTAL_W = Object.values(COL).reduce((sum, item) => sum + item.w, 0);
const TABLE_VIRTUALIZE_THRESHOLD = 120;
const TABLE_OVERSCAN_PX = 320;
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

function calcRowHeight(socket) {
  const ipLines = estimateVisualLines(splitBySpace(socket.endpoint_ip_raw), COL.ip.w, MONO_CHAR_W);
  const macLines = estimateVisualLines(splitBySpace(socket.mac_address || socket.endpoint_mac_raw), COL.mac.w, MONO_CHAR_W);
  const nameLines = estimateVisualLines(splitBySpace(socket.endpoint_name_raw), COL.name.w, TEXT_CHAR_W);
  const fioLines = estimateVisualLines(splitValues(socket.fio), COL.fio.w, TEXT_CHAR_W);
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

export default function SocketsTab({
  canEdit,
  socketSearch,
  setSocketSearch,
  filteredSockets,
  handleSocketRowClick,
  onCreateSocket,
  onDeleteSocket,
  deletingSocketId,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const tableMinWidth = canEdit ? TOTAL_W : TOTAL_W - COL.actions.w;
  const visibleColumnCount = canEdit ? Object.keys(COL).length : Object.keys(COL).length - 1;
  const useVirtualization = filteredSockets.length >= TABLE_VIRTUALIZE_THRESHOLD;

  const rowHeights = useMemo(() => filteredSockets.map(calcRowHeight), [filteredSockets]);
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

  const visibleSockets = useMemo(
    () => (useVirtualization ? filteredSockets.slice(startIndex, endIndex) : filteredSockets),
    [endIndex, filteredSockets, startIndex, useVirtualization],
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}>
      <Paper elevation={0} sx={getOfficeActionTraySx(ui, { p: 1.2, mb: 1 })}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap', minWidth: 110 }}>
            Розетки ({filteredSockets.length})
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder="Поиск: розетка / ASW / PORT / IP / MAC / ФИО"
            value={socketSearch}
            onChange={(event) => setSocketSearch(event.target.value)}
          />
          {canEdit ? (
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => onCreateSocket?.()}>
              Добавить
            </Button>
          ) : null}
        </Stack>
      </Paper>

      <Paper elevation={0} sx={getOfficePanelSx(ui, { flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
        {filteredSockets.length === 0 ? (
          <Box sx={{ px: 2, py: 3 }}>
            <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 2, textAlign: 'center' }) }}>
              <Typography variant="body2" color="text.secondary">
                Розетки не найдены.
              </Typography>
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
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.socket.w }}>Розетка</TableCell>
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.asw.w }}>ASW</TableCell>
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.port.w }}>PORT</TableCell>
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.location.w }}>Помещение</TableCell>
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.vlan.w }}>VLAN</TableCell>
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.ip.w }}>IP</TableCell>
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.mac.w }}>MAC</TableCell>
                  <TableCell sx={{ ...baseHeadCellSx, width: COL.name.w }}>Имя устройства</TableCell>
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

                {visibleSockets.map((socket) => {
                  const isDeleting = Number(deletingSocketId || 0) === Number(socket.id);
                  const ips = splitBySpace(socket.endpoint_ip_raw);
                  const macs = splitBySpace(socket.mac_address || socket.endpoint_mac_raw);
                  const names = splitBySpace(socket.endpoint_name_raw);
                  const fios = splitValues(socket.fio);

                  return (
                    <TableRow
                      key={socket.id}
                      hover
                      onClick={(event) => handleSocketRowClick(socket, event)}
                      sx={{
                        cursor: 'pointer',
                        ...getOfficeListRowSx(ui, theme),
                      }}
                    >
                      <TableCell sx={baseBodyCellSx}><TextLine bold color="primary.main" value={socket.socket_code || '-'} /></TableCell>
                      <TableCell sx={baseBodyCellSx}><TextLine value={socket.device_code || '-'} /></TableCell>
                      <TableCell sx={baseBodyCellSx}><MonoLine value={socket.port_name || '-'} /></TableCell>
                      <TableCell sx={baseBodyCellSx}><TextLine value={socket.location_code || '-'} /></TableCell>
                      <TableCell sx={baseBodyCellSx}><TextLine color="text.secondary" value={socket.vlan_raw || '-'} /></TableCell>
                      <TableCell sx={baseBodyCellSx}>
                        {ips.length > 0 ? ips.map((ip) => <MonoLine key={`${socket.id}-ip-${ip}`} value={ip} />) : <MonoLine value="-" />}
                      </TableCell>
                      <TableCell sx={baseBodyCellSx}>
                        {macs.length > 0 ? macs.map((mac) => <MonoLine key={`${socket.id}-mac-${mac}`} value={mac} />) : <MonoLine value="-" />}
                      </TableCell>
                      <TableCell sx={baseBodyCellSx}>
                        {names.length > 0 ? names.map((name) => <TextLine key={`${socket.id}-name-${name}`} value={name} />) : <TextLine value="-" />}
                      </TableCell>
                      <TableCell sx={baseBodyCellSx}>
                        {fios.length > 0 ? fios.map((fio) => <TextLine key={`${socket.id}-fio-${fio}`} value={fio} />) : <TextLine value="-" />}
                      </TableCell>
                      {canEdit && (
                        <TableCell align="center" sx={{ ...baseBodyCellSx, width: COL.actions.w }}>
                          <Tooltip title="Удалить розетку">
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                disabled={isDeleting}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDeleteSocket?.(socket, event);
                                }}
                              >
                                <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </span>
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
  );
}
