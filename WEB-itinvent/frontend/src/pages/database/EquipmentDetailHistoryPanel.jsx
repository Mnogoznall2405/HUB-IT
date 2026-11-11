import { memo } from 'react';
import {
  Alert,
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { LoadingSpinner } from '../../components/common';
import { readFirst } from './databaseRecordModel';

const EMPLOYEE_OLD_KEYS = ['old_employee_name', 'OLD_EMPLOYEE_NAME', 'old_employee_no', 'OLD_EMPLOYEE_NO'];
const EMPLOYEE_NEW_KEYS = ['new_employee_name', 'NEW_EMPLOYEE_NAME', 'new_employee_no', 'NEW_EMPLOYEE_NO'];
const BRANCH_OLD_KEYS = ['old_branch_name', 'OLD_BRANCH_NAME', 'old_branch_no', 'OLD_BRANCH_NO'];
const BRANCH_NEW_KEYS = ['new_branch_name', 'NEW_BRANCH_NAME', 'new_branch_no', 'NEW_BRANCH_NO'];
const LOCATION_OLD_KEYS = ['old_location_name', 'OLD_LOCATION_NAME', 'old_loc_no', 'OLD_LOC_NO'];
const LOCATION_NEW_KEYS = ['new_location_name', 'NEW_LOCATION_NAME', 'new_loc_no', 'NEW_LOC_NO'];

const EquipmentDetailHistoryPanel = memo(function EquipmentDetailHistoryPanel({
  history = [],
  error = '',
  loading = false,
  isMobile = false,
  onErrorClose,
  formatDate = (value) => value,
  formatHistoryValue = () => '-',
  formatHistoryTransition = () => '-',
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {error && (
        <Alert severity="error" onClose={onErrorClose}>
          {error}
        </Alert>
      )}

      {loading ? (
        <LoadingSpinner message="Загрузка истории..." />
      ) : history.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            История перемещений для этого оборудования пока пустая.
          </Typography>
        </Paper>
      ) : isMobile ? (
        <Box sx={{ display: 'grid', gap: 1 }}>
          {history.map((entry, index) => {
            const comment = String(readFirst(entry, ['ch_comment', 'CH_COMMENT'], '') || '').trim();

            return (
              <Paper
                key={`${readFirst(entry, ['hist_id', 'HIST_ID'], index)}-${index}`}
                variant="outlined"
                sx={{ p: 1.5, borderRadius: 1.5 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {formatDate(readFirst(entry, ['ch_date', 'CH_DATE'], ''))}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`#${formatHistoryValue(entry, ['hist_id', 'HIST_ID'])}`}
                  />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatHistoryTransition(entry, EMPLOYEE_OLD_KEYS, EMPLOYEE_NEW_KEYS)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {formatHistoryTransition(entry, BRANCH_OLD_KEYS, BRANCH_NEW_KEYS)}
                  {' / '}
                  {formatHistoryTransition(entry, LOCATION_OLD_KEYS, LOCATION_NEW_KEYS)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Пользователь: {formatHistoryValue(entry, ['ch_user', 'CH_USER'])}
                </Typography>
                {comment && (
                  <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                    {comment}
                  </Typography>
                )}
              </Paper>
            );
          })}
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Дата</TableCell>
                <TableCell>Сотрудник</TableCell>
                <TableCell>Филиал / Локация</TableCell>
                <TableCell>Пользователь</TableCell>
                <TableCell>Комментарий</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((entry, index) => (
                <TableRow key={`${readFirst(entry, ['hist_id', 'HIST_ID'], index)}-${index}`} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDate(readFirst(entry, ['ch_date', 'CH_DATE'], ''))}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      #{formatHistoryValue(entry, ['hist_id', 'HIST_ID'])}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {formatHistoryTransition(entry, EMPLOYEE_OLD_KEYS, EMPLOYEE_NEW_KEYS)}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatHistoryTransition(entry, BRANCH_OLD_KEYS, BRANCH_NEW_KEYS)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatHistoryTransition(entry, LOCATION_OLD_KEYS, LOCATION_NEW_KEYS)}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatHistoryValue(entry, ['ch_user', 'CH_USER'])}</TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {formatHistoryValue(entry, ['ch_comment', 'CH_COMMENT'])}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
});

export default EquipmentDetailHistoryPanel;
