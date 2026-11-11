import { memo } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

const getResolvedItemKey = (row, idx) => `${String(row?.item_id || 'unknown')}-${idx}`;

const UploadActResolvedItemsTable = memo(function UploadActResolvedItemsTable({ items }) {
  const rows = Array.isArray(items) ? items : [];

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
        Позиции, найденные по распознанным INV_NO
      </Typography>
      {rows.length > 0 ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Инв. №</TableCell>
              <TableCell>Серийный №</TableCell>
              <TableCell>Модель</TableCell>
              <TableCell>Сотрудник</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={getResolvedItemKey(row, idx)}>
                <TableCell>{row?.item_id || '-'}</TableCell>
                <TableCell>{row?.inv_no || '-'}</TableCell>
                <TableCell>{row?.serial_no || '-'}</TableCell>
                <TableCell>{row?.model_name || '-'}</TableCell>
                <TableCell>{row?.employee_name || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Позиции не определены автоматически. Укажите инв. номера вручную и проверьте их по PDF.
        </Typography>
      )}
    </Paper>
  );
});

export default UploadActResolvedItemsTable;
