import { memo } from 'react';
import {
  Alert,
  Box,
  Button,
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

const getActDocNo = (act, fallback = '') =>
  String(readFirst(act, ['doc_no', 'DOC_NO'], fallback));

const EquipmentDetailActsPanel = memo(function EquipmentDetailActsPanel({
  acts = [],
  error = '',
  loading = false,
  openingDocNo = '',
  onErrorClose,
  onOpenFields,
  onOpenFile,
  formatDate = (value) => value,
}) {
  const firstAct = acts[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {error && (
        <Alert severity="error" onClose={onErrorClose}>
          {error}
        </Alert>
      )}

      {loading ? (
        <LoadingSpinner message="Загрузка актов..." />
      ) : acts.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Для этого оборудования не найдено привязанных актов.
          </Typography>
        </Paper>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Текущий акт
            </Typography>
            <Typography variant="body2">
              № {readFirst(firstAct, ['doc_number', 'DOC_NUMBER'], '-')}
              {' | '}
              Дата: {formatDate(readFirst(firstAct, ['doc_date', 'DOC_DATE'], ''))}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Создан: {formatDate(readFirst(firstAct, ['create_date', 'CREATE_DATE'], ''))}
            </Typography>
          </Paper>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>№ документа</TableCell>
                  <TableCell>Дата</TableCell>
                  <TableCell>Тип</TableCell>
                  <TableCell>Филиал / Локация</TableCell>
                  <TableCell>Сотрудник</TableCell>
                  <TableCell align="right">Действия</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {acts.map((act, index) => {
                  const docNo = getActDocNo(act, index);
                  const isOpening = openingDocNo === docNo;

                  return (
                    <TableRow key={`${docNo}-${index}`} hover>
                      <TableCell>{readFirst(act, ['doc_number', 'DOC_NUMBER'], '-')}</TableCell>
                      <TableCell>{formatDate(readFirst(act, ['doc_date', 'DOC_DATE'], ''))}</TableCell>
                      <TableCell>{readFirst(act, ['type_name', 'TYPE_NAME', 'type_no', 'TYPE_NO'], '-')}</TableCell>
                      <TableCell>
                        {readFirst(act, ['branch_name', 'BRANCH_NAME'], '-')}
                        {' / '}
                        {readFirst(act, ['location_name', 'LOCATION_NAME'], '-')}
                      </TableCell>
                      <TableCell>{readFirst(act, ['employee_name', 'EMPLOYEE_NAME'], '-')}</TableCell>
                      <TableCell align="right">
                        <Box
                          sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 0.75,
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                          }}
                        >
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => onOpenFields?.(act)}
                          >
                            Поля
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => onOpenFile?.(act)}
                            disabled={isOpening}
                          >
                            {isOpening ? 'Открытие...' : 'Открыть'}
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  );
});

export default EquipmentDetailActsPanel;
