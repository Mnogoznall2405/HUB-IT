import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { formatDateTime } from './passwordVaultUtils';

export default function PasswordAuditAccordion({
  expanded = false,
  onExpandedChange,
  loading = false,
  items = [],
}) {
  return (
    <Accordion
      expanded={expanded}
      onChange={(_, next) => onExpandedChange?.(next)}
      disableGutters
      elevation={0}
      sx={{ borderRadius: '4px !important', '&:before': { display: 'none' } }}
      data-testid="password-audit-accordion"
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2" fontWeight={800}>
          Аудит доступа
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Событий аудита пока нет.
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Время</TableCell>
                  <TableCell>Действие</TableCell>
                  <TableCell>Пользователь</TableCell>
                  <TableCell>Запись</TableCell>
                  <TableCell>IP</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id || `${row.created_at}-${row.actor_username}-${row.action}`}>
                    <TableCell>{formatDateTime(row.created_at)}</TableCell>
                    <TableCell>{row.action || '—'}</TableCell>
                    <TableCell>{row.actor_username || row.actor_user_id || '—'}</TableCell>
                    <TableCell>{[row.entry_group, row.entry_login].filter(Boolean).join(' / ') || '—'}</TableCell>
                    <TableCell>{row.ip_address || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
