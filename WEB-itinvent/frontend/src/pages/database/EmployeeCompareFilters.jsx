import {
  Box,
  Button,
  Chip,
  Collapse,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { COMPARE_STATUS_LABEL } from './employeeCompareModel';

// Shared filter strip of the employee equipment dialog: free-text search,
// type/status selects and the clickable status/no-act/group chips. On mobile
// the whole strip is hidden behind a collapsible «Фильтры» toggle.
export default function EmployeeCompareFilters({
  isMobile,
  filtersOpen,
  onToggleFilters,
  canViewWarehouse1C,
  sharedFilter,
  onSharedFilterChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  equipmentTypes,
  statusCounts,
  noActFilter,
  onToggleNoAct,
  noActCount,
  hasHubItems,
  groupByType,
  onToggleGroupByType,
}) {
  return (
    <>
      {isMobile ? (
        <Button
          size="small"
          variant="outlined"
          onClick={onToggleFilters}
          endIcon={filtersOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          aria-expanded={filtersOpen}
          sx={{
            alignSelf: 'flex-start',
            minHeight: 40,
            mb: 1,
            textTransform: 'none',
            flexShrink: 0,
          }}
        >
          Фильтры{sharedFilter || typeFilter || statusFilter ? ' •' : ''}
        </Button>
      ) : null}

      <Collapse in={!isMobile || filtersOpen} unmountOnExit sx={{ flexShrink: 0 }}>
      <Box>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        sx={{ mb: 1.5 }}
      >
        <TextField
          size="small"
          label="Поиск"
          placeholder="Инв. №, модель, серийник, парт. №, номенклатура 1С…"
          value={sharedFilter}
          onChange={(event) => onSharedFilterChange(event.target.value)}
          sx={{ flex: '1 1 220px', minWidth: 180 }}
        />
        <TextField
          select
          size="small"
          label="Тип оборудования"
          value={typeFilter}
          onChange={(event) => onTypeFilterChange(event.target.value)}
          InputLabelProps={{ shrink: true }}
          SelectProps={{ displayEmpty: true }}
          sx={{ flex: '0 1 200px', minWidth: 160 }}
        >
          <MenuItem value="">Все типы</MenuItem>
          {equipmentTypes.map((type) => (
            <MenuItem key={type} value={type}>{type}</MenuItem>
          ))}
        </TextField>
        {canViewWarehouse1C ? (
          <TextField
            select
            size="small"
            label="Статус сверки"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
            InputLabelProps={{ shrink: true }}
            SelectProps={{ displayEmpty: true }}
            sx={{ flex: '0 1 190px', minWidth: 150 }}
          >
            <MenuItem value="">Все статусы</MenuItem>
            <MenuItem value="match">{COMPARE_STATUS_LABEL.match}</MenuItem>
            <MenuItem value="diff">{COMPARE_STATUS_LABEL.diff}</MenuItem>
            <MenuItem value="only_hub">{COMPARE_STATUS_LABEL.only_hub}</MenuItem>
            <MenuItem value="only_1c">{COMPARE_STATUS_LABEL.only_1c}</MenuItem>
            <MenuItem value="none">Без парт. № / кода</MenuItem>
          </TextField>
        ) : null}
      </Stack>

      {statusCounts || hasHubItems ? (
        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          flexWrap="wrap"
          sx={{ mb: 1.5, flexShrink: 0 }}
        >
          {statusCounts ? [
            ['match', COMPARE_STATUS_LABEL.match, 'success'],
            ['diff', COMPARE_STATUS_LABEL.diff, 'warning'],
            ['only_hub', COMPARE_STATUS_LABEL.only_hub, 'error'],
            ['only_1c', COMPARE_STATUS_LABEL.only_1c, 'info'],
            ['none', 'Без парт. №', 'default'],
          ].map(([key, label, color]) => (
            <Chip
              key={key}
              size="small"
              color={color === 'default' ? undefined : color}
              variant={statusFilter === key ? 'filled' : 'outlined'}
              label={`${label}: ${statusCounts[key]}`}
              onClick={() => onStatusFilterChange(statusFilter === key ? '' : key)}
            />
          )) : null}
          {hasHubItems ? (
            <Chip
              size="small"
              color={noActFilter ? 'primary' : 'default'}
              variant={noActFilter ? 'filled' : 'outlined'}
              label={`Без акта: ${noActCount}`}
              onClick={onToggleNoAct}
            />
          ) : null}
          {equipmentTypes.length > 1 ? (
            <Chip
              size="small"
              color={groupByType ? 'primary' : 'default'}
              variant={groupByType ? 'filled' : 'outlined'}
              label="По типам"
              onClick={onToggleGroupByType}
            />
          ) : null}
        </Stack>
      ) : null}
      </Box>
      </Collapse>
    </>
  );
}
