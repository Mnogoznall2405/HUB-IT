import React, { useMemo } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  buildOfficeUiTokens,
  getOfficeEmptyStateSx,
  getOfficePanelSx,
} from '../../theme/officeUiTokens';

export default function AuditTab({ audit }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);

  if (!audit || audit.length === 0) {
    return (
      <Paper elevation={0} sx={getOfficePanelSx(ui, { p: 2 })}>
        <Typography variant="body2" color="text.secondary" sx={getOfficeEmptyStateSx(ui, { p: 2, textAlign: 'center' })}>
          История изменений пуста
        </Typography>
      </Paper>
    );
  }

  const headCellSx = {
    py: 1,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'text.secondary',
    fontSize: '0.68rem',
    borderBottomColor: ui.borderStrong,
    bgcolor: ui.headerBandBg,
  };

  const bodyCellSx = {
    px: 2,
    py: 1,
    verticalAlign: 'top',
    borderBottomColor: ui.borderSoft,
    wordBreak: 'break-word',
  };

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={getOfficePanelSx(ui, {
        height: 620,
        overflowY: 'scroll',
        overflowX: 'auto',
        scrollbarGutter: 'stable both-edges',
      })}
    >
      <Table stickyHeader size="small" sx={{ minWidth: 520, tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ ...headCellSx, width: '25%' }}>Дата</TableCell>
            <TableCell sx={{ ...headCellSx, width: '25%' }}>Сущность</TableCell>
            <TableCell sx={{ ...headCellSx, width: '25%' }}>Действие</TableCell>
            <TableCell sx={{ ...headCellSx, width: '25%' }}>ID</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {audit.map((item, index) => (
            <TableRow key={`${item.created_at || 'audit'}-${item.id || item.entity_id || index}`}>
              <TableCell sx={bodyCellSx}>{item.created_at || '-'}</TableCell>
              <TableCell sx={bodyCellSx}>{item.entity_type || '-'}</TableCell>
              <TableCell sx={bodyCellSx}>{item.action || '-'}</TableCell>
              <TableCell sx={bodyCellSx}>{item.entity_id || '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
