import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { ticketsAPI } from '../../api/tickets';
import { getErrorMessage } from './ticketUi';

const steps = ['Файл', 'Предпросмотр', 'Запуск'];

export default function TicketImportWizard({ objects = [], canWrite = false }) {
  const [activeStep, setActiveStep] = useState(0);
  const [job, setJob] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [sheetObjectMap, setSheetObjectMap] = useState({});
  const [duplicateStrategy, setDuplicateStrategy] = useState('skip');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const uploadJob = await ticketsAPI.uploadImport(file);
      const previewData = await ticketsAPI.getImportPreview(uploadJob.id);
      const initialMap = {};
      (previewData?.sheets || []).forEach((sheet) => {
        if (sheet.matched_object_id) initialMap[sheet.title] = sheet.matched_object_id;
      });
      setJob(uploadJob);
      setPreview(previewData);
      setSheetObjectMap(initialMap);
      setActiveStep(1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const execute = async () => {
    if (!job) return;
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.executeImport(job.id, {
        color_map: preview?.color_map || {},
        duplicate_strategy: duplicateStrategy,
        sheet_object_map: sheetObjectMap,
      });
      setResult(data);
      setActiveStep(2);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stepper activeStep={activeStep}>
        {steps.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {!canWrite ? <Alert severity="info">Импорт доступен пользователям с правом записи.</Alert> : null}
      {canWrite && activeStep === 0 ? (
        <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 3, textAlign: 'center' }}>
          <Button component="label" variant="contained" startIcon={<UploadFileIcon />}>
            Загрузить .xlsx
            <input type="file" accept=".xlsx" hidden onChange={upload} />
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Файл до 50 МБ</Typography>
        </Box>
      ) : null}
      {preview ? (
        <Stack spacing={2}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{preview.file_name}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Лист</TableCell>
                <TableCell>Тип</TableCell>
                <TableCell>Строки</TableCell>
                <TableCell>Объект</TableCell>
                <TableCell>Заголовки</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(preview.sheets || []).map((sheet) => (
                <TableRow key={sheet.title}>
                  <TableCell>{sheet.title}</TableCell>
                  <TableCell><Chip size="small" label={sheet.classification} /></TableCell>
                  <TableCell>{sheet.row_count}</TableCell>
                  <TableCell>
                    <FormControl size="small" fullWidth>
                      <Select
                        value={sheetObjectMap[sheet.title] || ''}
                        onChange={(event) => setSheetObjectMap((prev) => ({ ...prev, [sheet.title]: event.target.value }))}
                        displayEmpty
                        disabled={sheet.classification !== 'рабочий'}
                      >
                        <MenuItem value="">Не выбран</MenuItem>
                        {objects.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell>{(sheet.headers || []).filter(Boolean).slice(0, 6).join(', ') || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Дубликаты</InputLabel>
              <Select value={duplicateStrategy} label="Дубликаты" onChange={(event) => setDuplicateStrategy(event.target.value)}>
                <MenuItem value="skip">Пропускать</MenuItem>
                <MenuItem value="update">Обновлять</MenuItem>
                <MenuItem value="create">Создавать новые</MenuItem>
              </Select>
            </FormControl>
            <Button startIcon={<PlayArrowIcon />} variant="contained" onClick={execute} disabled={!canWrite}>Запустить импорт</Button>
          </Stack>
        </Stack>
      ) : null}
      {result ? (
        <Alert severity={result.errors ? 'warning' : 'success'}>
          Импортировано: {result.imported}, пропущено: {result.skipped}, ошибок: {result.errors}, предупреждений: {result.warnings}
        </Alert>
      ) : null}
    </Stack>
  );
}
