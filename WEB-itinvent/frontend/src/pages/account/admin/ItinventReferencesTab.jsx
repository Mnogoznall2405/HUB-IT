import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import { useNotification } from '../../../contexts/NotificationContext';
import { getReferenceErrorMessage, itinventReferencesAPI } from '../../../api/itinventReferences';
import { buildOfficeUiTokens, getOfficePanelSx } from '../../../theme/officeUiTokens';

const CI_TYPE_OPTIONS = [
  { value: 1, label: 'Оборудование' },
  { value: 4, label: 'Расходники' },
];

const KIND_TABS = [
  { kind: 'vendors', label: 'Производители', singular: 'производителя' },
  { kind: 'types', label: 'Типы', singular: 'тип', scopedByCiType: true },
  { kind: 'models', label: 'Модели', singular: 'модель', scopedByCiType: true },
  { kind: 'branches', label: 'Филиалы', singular: 'филиал' },
  { kind: 'locations', label: 'Кабинеты', singular: 'кабинет' },
  { kind: 'statuses', label: 'Статусы', singular: 'статус' },
];

const PAGE_SIZES = [25, 50, 100];
const emptyDraft = { name: '', type_no: '', vendor_no: '', branch_nos: [] };
const emptyLookups = { types: [], vendors: [], branches: [] };
const NO_FILTER = { type: null, vendor: null, branch: null };
const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

const optionLabel = (option) => String(option?.name ?? '');
const sameId = (option, value) => Number(option?.id) === Number(value?.id);
const noOptionsText = 'Ничего не найдено';

function SearchSelect({ label, placeholder, options, value, onChange, size = 'small', sx }) {
  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, next) => onChange(next)}
      getOptionLabel={optionLabel}
      isOptionEqualToValue={sameId}
      noOptionsText={noOptionsText}
      clearText="Сбросить"
      openText="Открыть"
      closeText="Закрыть"
      autoHighlight
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} InputLabelProps={{ ...params.InputLabelProps, shrink: true }} />
      )}
      size={size}
      sx={sx}
    />
  );
}

function ReferenceFormDialog({ open, tab, row, preset, lookups, saving, error, onClose, onSubmit }) {
  const [draft, setDraft] = useState(emptyDraft);
  const nameRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setDraft(row
      ? {
        name: row.name || '',
        type_no: row.type_no ?? '',
        vendor_no: row.vendor_no ?? '',
        branch_nos: row.branch_nos || [],
      }
      : { ...emptyDraft, ...(preset || {}) });
  }, [open, row, preset]);

  const isModel = tab.kind === 'models';
  const isLocation = tab.kind === 'locations';
  const canSubmit = Boolean(draft.name.trim())
    && (!isModel || draft.type_no !== '')
    && (!isLocation || draft.branch_nos.length > 0);

  const typeValue = useMemo(
    () => lookups.types.find((item) => Number(item.id) === Number(draft.type_no)) || null,
    [lookups.types, draft.type_no],
  );
  const vendorValue = useMemo(
    () => lookups.vendors.find((item) => Number(item.id) === Number(draft.vendor_no)) || null,
    [lookups.vendors, draft.vendor_no],
  );
  const branchValue = useMemo(
    () => lookups.branches.filter((item) => draft.branch_nos.some((no) => Number(no) === Number(item.id))),
    [lookups.branches, draft.branch_nos],
  );

  const submit = async (keepOpen) => {
    if (!canSubmit || saving) return;
    const payload = { name: draft.name };
    if (isModel) {
      payload.type_no = Number(draft.type_no);
      payload.vendor_no = draft.vendor_no === '' ? null : Number(draft.vendor_no);
    }
    if (isLocation) payload.branch_nos = draft.branch_nos.map(Number);
    const ok = await onSubmit(payload, keepOpen);
    if (ok && keepOpen) {
      setDraft((prev) => ({ ...prev, name: '' }));
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    void submit(false);
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{row ? `Изменить ${tab.singular}` : `Добавить ${tab.singular}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="Название"
              placeholder="Введите название"
              InputLabelProps={{ shrink: true }}
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              inputProps={{ maxLength: 255 }}
              inputRef={nameRef}
              autoFocus
              required
              fullWidth
            />
            {isModel ? (
              <>
                <SearchSelect
                  label="Тип *"
                  placeholder="Выберите тип"
                  options={lookups.types}
                  value={typeValue}
                  onChange={(next) => setDraft((prev) => ({ ...prev, type_no: next ? next.id : '' }))}
                  size="medium"
                />
                <SearchSelect
                  label="Производитель"
                  placeholder="Не указан"
                  options={lookups.vendors}
                  value={vendorValue}
                  onChange={(next) => setDraft((prev) => ({ ...prev, vendor_no: next ? next.id : '' }))}
                  size="medium"
                />
              </>
            ) : null}
            {isLocation ? (
              <Autocomplete
                multiple
                disableCloseOnSelect
                autoHighlight
                options={lookups.branches}
                value={branchValue}
                onChange={(_, next) => setDraft((prev) => ({ ...prev, branch_nos: next.map((item) => item.id) }))}
                getOptionLabel={optionLabel}
                isOptionEqualToValue={sameId}
                noOptionsText={noOptionsText}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Филиалы *"
                    placeholder={branchValue.length ? '' : 'Выберите филиалы'}
                    InputLabelProps={{ ...params.InputLabelProps, shrink: true }}
                    helperText="Кабинет можно привязать к нескольким филиалам"
                  />
                )}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Отмена</Button>
          {!row ? (
            <Button onClick={() => { void submit(true); }} disabled={!canSubmit || saving}>
              Сохранить и добавить ещё
            </Button>
          ) : null}
          <Button type="submit" variant="contained" disabled={!canSubmit || saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function DeleteReferenceDialog({ target, tab, usage, usageLoading, deleting, error, onClose, onConfirm }) {
  const blocked = Boolean(usage && usage.total > 0);
  return (
    <Dialog open={Boolean(target)} onClose={deleting ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Удалить {tab.singular}?</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Typography variant="body2"><strong>{target?.name}</strong></Typography>
          {usageLoading ? <CircularProgress size={20} /> : null}
          {blocked ? (
            <Alert severity="warning">
              Запись используется, удалить её нельзя:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {usage.usage.map((item) => (
                  <li key={item.table}>{item.label}: {item.count}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {!usageLoading && usage && !blocked ? (
            <Typography variant="body2" color="text.secondary">
              Запись нигде не используется. Удаление необратимо.
            </Typography>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>Отмена</Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={deleting || usageLoading || !usage || blocked}
        >
          {deleting ? 'Удаление…' : 'Удалить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const ReferenceRow = memo(function ReferenceRow({ row, kind, branchNameById, onEdit, onDelete }) {
  return (
    <TableRow hover>
      <TableCell sx={{ wordBreak: 'break-word' }}>{row.name}</TableCell>
      {kind === 'models' ? <TableCell>{row.type_name || '—'}</TableCell> : null}
      {kind === 'models' ? <TableCell>{row.vendor_name || '—'}</TableCell> : null}
      {kind === 'locations' ? (
        <TableCell>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {(row.branch_nos || []).map((no) => (
              <Chip key={no} size="small" label={branchNameById.get(Number(no)) || no} />
            ))}
          </Box>
        </TableCell>
      ) : null}
      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
        <IconButton size="small" title="Изменить" aria-label={`Изменить ${row.name}`} onClick={() => onEdit(row)}>
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" title="Удалить" aria-label={`Удалить ${row.name}`} onClick={() => onDelete(row)}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  );
});

export default function ItinventReferencesTab({ dbOptions = [], defaultDbId = '' }) {
  const { notifySuccess } = useNotification();
  const onNotify = useCallback((message) => notifySuccess(message, { source: 'settings' }), [notifySuccess]);
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const databases = useMemo(() => (Array.isArray(dbOptions) ? dbOptions : []), [dbOptions]);
  const [dbId, setDbId] = useState(() => String(defaultDbId || databases[0]?.id || ''));
  const [kindIndex, setKindIndex] = useState(0);
  const [ciType, setCiType] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDeferredValue(searchInput);
  const [filters, setFilters] = useState(NO_FILTER);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lookups, setLookups] = useState(emptyLookups);
  const [formState, setFormState] = useState({ open: false, row: null, preset: null });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const loadSeq = useRef(0);

  const tab = KIND_TABS[kindIndex];
  const ciScope = tab.scopedByCiType ? ciType : undefined;
  const selectedDb = useMemo(
    () => databases.find((item) => String(item.id) === String(dbId)) || null,
    [databases, dbId],
  );

  useEffect(() => {
    if (!dbId && databases[0]?.id) setDbId(String(databases[0].id));
  }, [dbId, databases]);

  // Whole list is loaded once per (db, kind, category); search and filters run in the browser.
  const loadRows = useCallback(async () => {
    if (!dbId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError('');
    try {
      const payload = await itinventReferencesAPI.list(tab.kind, { dbId, ci_type: ciScope });
      if (seq !== loadSeq.current) return;
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setAllRows([...items].sort((a, b) => collator.compare(String(a.name || ''), String(b.name || ''))));
    } catch (error) {
      if (seq !== loadSeq.current) return;
      setAllRows([]);
      setLoadError(getReferenceErrorMessage(error, 'Не удалось загрузить справочник.'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [ciScope, dbId, tab.kind]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const loadLookups = useCallback(async () => {
    if (!dbId) return;
    try {
      const [types, vendors, branches] = await Promise.all([
        itinventReferencesAPI.list('types', { dbId, ci_type: ciType }),
        itinventReferencesAPI.list('vendors', { dbId }),
        itinventReferencesAPI.list('branches', { dbId }),
      ]);
      const byName = (items) => [...(items || [])].sort((a, b) => collator.compare(String(a.name || ''), String(b.name || '')));
      setLookups({ types: byName(types.items), vendors: byName(vendors.items), branches: byName(branches.items) });
    } catch {
      setLookups(emptyLookups);
    }
  }, [ciType, dbId]);

  useEffect(() => { void loadLookups(); }, [loadLookups]);

  const branchNameById = useMemo(
    () => new Map(lookups.branches.map((item) => [Number(item.id), item.name])),
    [lookups.branches],
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (filters.type && Number(row.type_no) !== Number(filters.type.id)) return false;
      if (filters.vendor && Number(row.vendor_no) !== Number(filters.vendor.id)) return false;
      if (filters.branch && !(row.branch_nos || []).some((no) => Number(no) === Number(filters.branch.id))) return false;
      if (!needle) return true;
      const haystack = [
        row.name,
        row.type_name,
        row.vendor_name,
        ...(row.branch_nos || []).map((no) => branchNameById.get(Number(no)) || ''),
      ].join('\n').toLowerCase();
      return haystack.includes(needle);
    });
  }, [allRows, branchNameById, filters, search]);

  const pageCount = Math.max(0, Math.ceil(filteredRows.length / pageSize) - 1);
  const safePage = Math.min(page, pageCount);
  const visibleRows = useMemo(
    () => filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filteredRows, pageSize, safePage],
  );

  const resetView = () => {
    setSearchInput('');
    setFilters(NO_FILTER);
    setPage(0);
  };

  const changeFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const openCreate = () => {
    setFormError('');
    const preset = {};
    if (tab.kind === 'models') {
      if (filters.type) preset.type_no = filters.type.id;
      if (filters.vendor) preset.vendor_no = filters.vendor.id;
    }
    if (tab.kind === 'locations' && filters.branch) preset.branch_nos = [filters.branch.id];
    setFormState({ open: true, row: null, preset });
  };

  const openEdit = useCallback((row) => {
    setFormError('');
    setFormState({ open: true, row, preset: null });
  }, []);

  const closeForm = () => {
    if (saving) return;
    setFormState({ open: false, row: null, preset: null });
    setFormError('');
  };

  const handleSubmit = async (payload, keepOpen) => {
    setSaving(true);
    setFormError('');
    try {
      const request = tab.scopedByCiType && !formState.row ? { ...payload, ci_type: ciType } : payload;
      if (formState.row) {
        await itinventReferencesAPI.update(tab.kind, formState.row.id, request, { dbId, ciType: ciScope });
        onNotify?.(`Изменения сохранены: ${payload.name}`);
      } else {
        await itinventReferencesAPI.create(tab.kind, request, { dbId });
        onNotify?.(`Добавлено: ${payload.name}`);
      }
      if (!keepOpen) setFormState({ open: false, row: null, preset: null });
      const needsLookups = ['vendors', 'types', 'branches'].includes(tab.kind);
      await Promise.all([loadRows(), needsLookups ? loadLookups() : null]);
      return true;
    } catch (error) {
      setFormError(getReferenceErrorMessage(error, 'Не удалось сохранить запись.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openDelete = useCallback(async (row) => {
    setDeleteTarget(row);
    setUsage(null);
    setDeleteError('');
    setUsageLoading(true);
    try {
      setUsage(await itinventReferencesAPI.usage(tab.kind, row.id, { dbId, ciType: ciScope }));
    } catch (error) {
      setDeleteError(getReferenceErrorMessage(error, 'Не удалось проверить использование записи.'));
    } finally {
      setUsageLoading(false);
    }
  }, [ciScope, dbId, tab.kind]);

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setUsage(null);
    setDeleteError('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await itinventReferencesAPI.remove(tab.kind, deleteTarget.id, { dbId, ciType: ciScope });
      onNotify?.(`Удалено: ${deleteTarget.name}`);
      setDeleteTarget(null);
      setUsage(null);
      const needsLookups = ['vendors', 'types', 'branches'].includes(tab.kind);
      await Promise.all([loadRows(), needsLookups ? loadLookups() : null]);
    } catch (error) {
      setDeleteError(getReferenceErrorMessage(error, 'Не удалось удалить запись.'));
    } finally {
      setDeleting(false);
    }
  };

  const columnCount = tab.kind === 'models' ? 4 : (tab.kind === 'locations' ? 3 : 2);
  const hasActiveFilter = Boolean(searchInput.trim() || filters.type || filters.vendor || filters.branch);

  return (
    <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui), p: { xs: 1.5, md: 2 } }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
          <Typography variant="h6">Справочники ITINVENT</Typography>
          <Autocomplete
            size="small"
            disableClearable
            autoHighlight
            options={databases}
            value={selectedDb}
            onChange={(_, next) => { setDbId(String(next.id)); resetView(); }}
            getOptionLabel={(item) => String(item?.name || item?.id || '')}
            isOptionEqualToValue={(a, b) => String(a?.id) === String(b?.id)}
            noOptionsText={noOptionsText}
            renderInput={(params) => <TextField {...params} label="База" />}
            sx={{ minWidth: 260 }}
          />
        </Stack>

        <Tabs
          value={kindIndex}
          onChange={(_, value) => { setKindIndex(value); resetView(); setAllRows([]); }}
          variant="scrollable"
          scrollButtons="auto"
        >
          {KIND_TABS.map((item) => <Tab key={item.kind} label={item.label} />)}
        </Tabs>

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
          <TextField
            size="small"
            placeholder="Поиск по названию"
            value={searchInput}
            onChange={(event) => { setSearchInput(event.target.value); setPage(0); }}
            sx={{ flex: 1, minWidth: 0 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment>
              ),
              endAdornment: searchInput ? (
                <InputAdornment position="end">
                  <IconButton size="small" aria-label="Очистить поиск" onClick={() => { setSearchInput(''); setPage(0); }}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
          <Button
            variant="contained"
            startIcon={<AddOutlinedIcon />}
            onClick={openCreate}
            disabled={!dbId}
            sx={{ height: 40, minWidth: 170, flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            Добавить
          </Button>
        </Box>

        {tab.scopedByCiType || tab.kind === 'locations' ? (
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
              '& .MuiAutocomplete-root': { width: '100%', minWidth: 0 },
            }}
          >
            {tab.scopedByCiType ? (
              <Autocomplete
                size="small"
                disableClearable
                autoHighlight
                options={CI_TYPE_OPTIONS}
                value={CI_TYPE_OPTIONS.find((item) => item.value === ciType)}
                onChange={(_, next) => { setCiType(next.value); setFilters(NO_FILTER); setPage(0); }}
                getOptionLabel={(item) => item.label}
                isOptionEqualToValue={(a, b) => a.value === b.value}
                renderInput={(params) => (
                  <TextField {...params} label="Категория" InputLabelProps={{ ...params.InputLabelProps, shrink: true }} />
                )}
              />
            ) : null}
            {tab.kind === 'models' ? (
              <>
                <SearchSelect
                  label="Тип"
                  placeholder="Все типы"
                  options={lookups.types}
                  value={filters.type}
                  onChange={(next) => changeFilter('type', next)}
                />
                <SearchSelect
                  label="Производитель"
                  placeholder="Все производители"
                  options={lookups.vendors}
                  value={filters.vendor}
                  onChange={(next) => changeFilter('vendor', next)}
                />
              </>
            ) : null}
            {tab.kind === 'locations' ? (
              <SearchSelect
                label="Филиал"
                placeholder="Все филиалы"
                options={lookups.branches}
                value={filters.branch}
                onChange={(next) => changeFilter('branch', next)}
              />
            ) : null}
          </Box>
        ) : null}

        {loadError ? <Alert severity="error">{loadError}</Alert> : null}

        <TableContainer sx={{ maxHeight: { md: 'calc(100vh - 380px)' }, minHeight: 200 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                {tab.kind === 'models' ? <TableCell>Тип</TableCell> : null}
                {tab.kind === 'models' ? <TableCell>Производитель</TableCell> : null}
                {tab.kind === 'locations' ? <TableCell>Филиалы</TableCell> : null}
                <TableCell align="right" sx={{ width: 100 }}>Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={columnCount} align="center"><CircularProgress size={22} /></TableCell></TableRow>
              ) : null}
              {!loading && visibleRows.length === 0 && !loadError ? (
                <TableRow>
                  <TableCell colSpan={columnCount} align="center">
                    Ничего не найдено
                    {hasActiveFilter ? (
                      <Button size="small" onClick={resetView} sx={{ ml: 1 }}>Сбросить фильтры</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ) : null}
              {!loading ? visibleRows.map((row) => (
                <ReferenceRow
                  key={`${tab.kind}-${row.id}-${row.ci_type || ''}`}
                  row={row}
                  kind={tab.kind}
                  branchNameById={branchNameById}
                  onEdit={openEdit}
                  onDelete={openDelete}
                />
              )) : null}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filteredRows.length}
          page={safePage}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}
          rowsPerPageOptions={PAGE_SIZES}
          labelRowsPerPage="На странице"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}${allRows.length !== count ? ` (всего ${allRows.length})` : ''}`}
        />
        <Typography variant="caption" color="text.secondary">
          Изменения сразу видны в формах оборудования; удалить можно только то, что нигде не используется.
        </Typography>
      </Stack>

      <ReferenceFormDialog
        open={formState.open}
        tab={tab}
        row={formState.row}
        preset={formState.preset}
        lookups={lookups}
        saving={saving}
        error={formError}
        onClose={closeForm}
        onSubmit={handleSubmit}
      />
      <DeleteReferenceDialog
        target={deleteTarget}
        tab={tab}
        usage={usage}
        usageLoading={usageLoading}
        deleting={deleting}
        error={deleteError}
        onClose={closeDelete}
        onConfirm={confirmDelete}
      />
    </Paper>
  );
}
