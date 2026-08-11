import { memo, useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined';

const visuallyHiddenSx = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

function formatUnitCount(value) {
  const count = Math.max(0, Number(value || 0));
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11
    ? 'единица'
    : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'единицы' : 'единиц');
  return `${count.toLocaleString('ru-RU')} ${noun}`;
}

function EmployeeSummary({ employee, warehouse, warehouseStatus, warehouseQuantity, onOpen }) {
  const employeeName = String(employee?.name || '').trim();
  const department = String(employee?.department || '').trim();
  const matchedWarehouse = warehouseStatus === 'matched' ? warehouse : null;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.25, sm: 1.5 },
        borderRadius: '10px',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {employeeName || 'Сотрудник Хаба'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {[department, matchedWarehouse ? `В 1С: ${formatUnitCount(warehouseQuantity)}` : '']
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          {matchedWarehouse?.name ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Склад 1С: {matchedWarehouse.name}
            </Typography>
          ) : null}
        </Box>
        <Button
          variant="outlined"
          size="small"
          onClick={() => onOpen?.({
            ownerNo: employee?.owner_no,
            employeeName,
            warehouseRef: matchedWarehouse?.ref || '',
          })}
          sx={{ minHeight: 40, flexShrink: 0 }}
        >
          Открыть сотрудника
        </Button>
      </Stack>
    </Paper>
  );
}

function WarehouseCandidateList({ candidates, employee = null, query, onOpen }) {
  if (!candidates.length) return null;
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Найдено несколько похожих складов — выберите нужный:
      </Typography>
      <List disablePadding sx={{ display: 'grid', gap: 0.75 }}>
        {candidates.map((candidate) => (
          <ListItemButton
            key={candidate.ref}
            onClick={() => onOpen?.({
              ownerNo: employee?.owner_no || null,
              employeeName: String(employee?.name || candidate.name || query).trim(),
              warehouseRef: candidate.ref,
            })}
            sx={{
              minHeight: 44,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '10px',
            }}
          >
            <ListItemText
              primary={candidate.name}
              secondary="Открыть склад и посмотреть остатки"
              primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

const DatabaseEmployeeSearchFallback = memo(function DatabaseEmployeeSearchFallback({
  active = false,
  query = '',
  loading = false,
  employees = [],
  employeeError = '',
  warehouseError = '',
  warehouseStatus = '',
  warehouse = null,
  warehouseCandidates = [],
  warehouseQuantity = null,
  employeeWarehouseResults = {},
  onOpenEmployee,
  onRetry,
  theme,
  ui,
}) {
  const employeeList = Array.isArray(employees) ? employees : [];
  const candidates = Array.isArray(warehouseCandidates) ? warehouseCandidates : [];
  const singleEmployee = employeeList.length === 1 ? employeeList[0] : null;
  const textSecondary = ui?.textSecondary || theme.palette.text.secondary;
  const panelBg = ui?.panelBg || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.04);
  const borderSoft = ui?.borderSoft || theme.palette.divider;

  const statusMessage = useMemo(() => {
    if (!active) return '';
    if (loading) return 'Идёт поиск сотрудника в Хабе и склада в 1С.';
    if (employeeList.length > 1) return `Найдено сотрудников: ${employeeList.length}. Выберите нужного.`;
    if (warehouseStatus === 'matched' && warehouse?.name) return `Найден склад 1С: ${warehouse.name}.`;
    if (warehouseStatus === 'ambiguous') return `Найдено похожих складов: ${candidates.length}.`;
    if (warehouseStatus === 'not_found') return 'Склад сотрудника в 1С не найден.';
    if (employeeError || warehouseError) return 'Поиск завершился с ошибкой.';
    return 'Поиск завершён.';
  }, [active, candidates.length, employeeError, employeeList.length, loading, warehouse?.name, warehouseError, warehouseStatus]);

  if (!active) return null;

  return (
    <Paper
      component="section"
      aria-labelledby="database-employee-fallback-title"
      aria-busy={loading || undefined}
      variant="outlined"
      data-testid="database-employee-fallback"
      sx={{
        mb: 1.5,
        p: { xs: 1.25, sm: 1.75 },
        borderRadius: '12px',
        borderColor: borderSoft,
        bgcolor: panelBg,
      }}
    >
      <Box role="status" sx={visuallyHiddenSx}>{statusMessage}</Box>

      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1.5 }}>
        <PersonSearchOutlinedIcon color="primary" aria-hidden="true" sx={{ mt: 0.15 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography id="database-employee-fallback-title" variant="subtitle2" sx={{ fontWeight: 700 }}>
            В Хабе техника не найдена
          </Typography>
          <Typography variant="caption" sx={{ color: textSecondary, display: 'block', mt: 0.25 }}>
            {loading
              ? `Проверяем сотрудника и его склад в 1С по запросу «${query}».`
              : `Результаты по запросу «${query}». Остатки 1С откроются после выбора.`}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={1.5}>
        {employeeError ? (
          <Alert
            severity="warning"
            action={<Button color="inherit" size="small" onClick={onRetry}>Повторить</Button>}
          >
            {employeeError}
          </Alert>
        ) : null}

        {warehouseError ? (
          <Alert
            severity="warning"
            action={<Button color="inherit" size="small" onClick={onRetry}>Повторить</Button>}
          >
            {warehouseError}
          </Alert>
        ) : null}

        {loading ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 40 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              {singleEmployee ? 'Проверяем склад сотрудника в 1С…' : 'Ищем сотрудника в Хабе…'}
            </Typography>
          </Stack>
        ) : null}

        {employeeList.length > 1 ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              В справочнике Хаба найдено несколько сотрудников. Склады 1С проверены по полному ФИО — выберите нужного.
            </Typography>
            <List disablePadding sx={{ display: 'grid', gap: 0.75 }}>
              {employeeList.map((employee) => {
                const employeeWarehouse = employeeWarehouseResults?.[
                  String(employee?.owner_no ?? employee?.name ?? '').trim()
                ] || null;
                const warehouseCaption = employeeWarehouse?.status === 'matched'
                  ? `В 1С: ${formatUnitCount(employeeWarehouse.quantity)}`
                  : (employeeWarehouse?.status === 'ambiguous'
                    ? 'В 1С: нужно выбрать склад'
                    : (employeeWarehouse?.status === 'not_found'
                      ? 'Склад 1С не найден'
                      : (employeeWarehouse?.error ? 'Ошибка поиска в 1С' : '')));
                return (
                  <ListItemButton
                    key={employee.owner_no}
                    onClick={() => onOpenEmployee?.({
                      ownerNo: employee.owner_no,
                      employeeName: String(employee.name || '').trim(),
                      warehouseRef: employeeWarehouse?.status === 'matched'
                        ? employeeWarehouse?.warehouse?.ref || ''
                        : '',
                    })}
                    sx={{
                      minHeight: 48,
                      border: '1px solid',
                      borderColor: borderSoft,
                      borderRadius: '10px',
                    }}
                  >
                    <ListItemText
                      primary={employee.name}
                      secondary={[employee.department, warehouseCaption]
                        .filter(Boolean)
                        .join(' · ')}
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 700 }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        ) : null}

        {singleEmployee ? (
          <EmployeeSummary
            employee={singleEmployee}
            warehouse={warehouse}
            warehouseStatus={warehouseStatus}
            warehouseQuantity={warehouseQuantity}
            onOpen={onOpenEmployee}
          />
        ) : null}

        {employeeList.length <= 1 && warehouseStatus === 'ambiguous' ? (
          <WarehouseCandidateList
            candidates={candidates}
            employee={singleEmployee}
            query={query}
            onOpen={onOpenEmployee}
          />
        ) : null}

        {!singleEmployee && warehouseStatus === 'matched' && warehouse?.ref ? (
          <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.5 }, borderRadius: '10px' }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              justifyContent="space-between"
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                <Inventory2OutlinedIcon color="primary" aria-hidden="true" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {warehouse.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Сотрудник отсутствует в справочнике Хаба · В 1С: {formatUnitCount(warehouseQuantity)}.
                  </Typography>
                </Box>
              </Stack>
              <Button
                variant="outlined"
                size="small"
                onClick={() => onOpenEmployee?.({
                  ownerNo: null,
                  employeeName: String(warehouse.name || query).trim(),
                  warehouseRef: warehouse.ref,
                })}
                sx={{ minHeight: 40, flexShrink: 0 }}
              >
                Открыть склад и остатки
              </Button>
            </Stack>
          </Paper>
        ) : null}

        {!loading && warehouseStatus === 'not_found' ? (
          <Alert severity="info">
            {singleEmployee
              ? 'Сотрудник найден в Хабе, но склад с таким ФИО в 1С не найден.'
              : 'По этому запросу не найдено ни сотрудника в Хабе, ни склада в 1С.'}
          </Alert>
        ) : null}

        {!loading
          && !employeeError
          && !warehouseError
          && employeeList.length === 0
          && !warehouseStatus ? (
            <Alert severity="info">Поиск не вернул результатов.</Alert>
          ) : null}

        {singleEmployee && warehouseStatus === 'ambiguous' ? (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label="Нужно выбрать склад 1С"
            sx={{ alignSelf: 'flex-start' }}
          />
        ) : null}
      </Stack>
    </Paper>
  );
});

export default DatabaseEmployeeSearchFallback;
