import { Alert, Box, Button, CircularProgress, List, ListItemButton, Paper, Stack, Typography } from '@mui/material';

// Компактная плашка: заголовок и счётчик в одну строку, сотрудники — плотной
// сеткой (имя + отдел/техника в одной строке), без больших карточек.
export default function DatabaseEmployeeSearchResults({ search, onOpenEmployee }) {
  const { query, employees, total, loading, error, retry, loadMore } = search;
  return (
    <Paper component="section" aria-label="Результаты поиска сотрудников" variant="outlined"
      sx={{ px: 1.25, py: 0.75, mb: 1, borderRadius: '8px' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Сотрудники ITinvent</Typography>
        {total != null && (
          <Typography role="status" variant="caption" color="text.secondary">
            Показано {employees.length} из {total}
          </Typography>
        )}
      </Box>
      {query.length < 2 ? <Alert severity="info" sx={{ py: 0 }}>Введите минимум 2 символа ФИО или подразделения. Поиск включает сотрудников без техники.</Alert> : (
        <Stack spacing={0.75}>
          {error && <Alert severity="error" sx={{ py: 0 }} action={<Button color="inherit" onClick={retry}>Повторить</Button>}>{error}</Alert>}
          <List
            disablePadding
            sx={{
              display: 'grid',
              gap: 0.5,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
            }}
          >
            {employees.map(employee => (
              <ListItemButton key={employee.owner_no}
                onClick={() => onOpenEmployee({ ownerNo: employee.owner_no, employeeName: employee.name })}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '6px',
                  minHeight: 36,
                  py: 0.25,
                  px: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 1,
                }}>
                <Typography variant="body2" noWrap title={employee.name} sx={{ fontWeight: 600, minWidth: 0, flexShrink: 1 }}>
                  {employee.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1, textAlign: 'right' }}
                  title={[employee.department, `Техника: ${employee.equipment_count}`].filter(Boolean).join(' · ')}>
                  {[employee.department, `Техника: ${employee.equipment_count}`].filter(Boolean).join(' · ')}
                </Typography>
              </ListItemButton>
            ))}
          </List>
          {loading && <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={18} />Загрузка сотрудников…
          </Box>}
          {!loading && !error && total === 0 && <Alert severity="info" sx={{ py: 0 }}>Сотрудники не найдены в текущей базе ITinvent.</Alert>}
          {total != null && employees.length < total && <Button size="small" onClick={loadMore} disabled={loading} sx={{ alignSelf: 'flex-start' }}>Показать ещё сотрудников</Button>}
        </Stack>
      )}
    </Paper>
  );
}
