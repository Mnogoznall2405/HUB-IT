import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SearchIcon from '@mui/icons-material/Search';

import { isMeaningful1cRef, warehouse1cAPI } from '../../api/warehouse1c';
import { readFirst } from './databaseRecordModel';
import {
  formatWarehouseQty,
  NomenclatureCell,
  resolveWarehouseErrorMessage,
} from './warehouse1cShared';

const PART_NO_PLACEHOLDER_RE = /не\s*найден/i;
const NOMENCLATURE_SEARCH_LIMIT = 50;

function isUsablePartNo(value) {
  const text = String(value || '').trim();
  if (!text || text === '-' || text === '—') return false;
  if (PART_NO_PLACEHOLDER_RE.test(text)) return false;
  return true;
}

function buildModelSearchText(data) {
  const model = String(readFirst(data, ['MODEL_NAME', 'model_name'], '')).trim();
  if (model) return model;
  const typeName = String(readFirst(data, ['TYPE_NAME', 'type_name'], '')).trim();
  const vendorName = String(readFirst(data, ['VENDOR_NAME', 'vendor_name', 'manufacturer'], '')).trim();
  return [typeName, vendorName].filter(Boolean).join(' ').trim();
}

function buildDefaultSearchPlan(data) {
  const partNo = String(readFirst(data, ['PART_NO', 'part_no'], '')).trim();
  const modelText = buildModelSearchText(data);
  if (isUsablePartNo(partNo)) {
    return {
      primaryQuery: partNo,
      fallbackQuery: modelText && modelText !== partNo ? modelText : '',
      preferredSource: 'part_no',
    };
  }
  return {
    primaryQuery: modelText,
    fallbackQuery: '',
    preferredSource: 'model',
  };
}

async function filterSuggestionsWithPositiveBalances(items, { concurrency = 4 } = {}) {
  const list = Array.isArray(items) ? items.filter((item) => isMeaningful1cRef(item?.ref)) : [];
  if (!list.length) return [];

  const kept = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    const checks = await Promise.all(chunk.map(async (item) => {
      try {
        const rows = await warehouse1cAPI.getBalances({
          nomenclatureRef: item.ref,
          limit: 20,
        });
        return Array.isArray(rows) && rows.length > 0 ? item : null;
      } catch (err) {
        console.warn('Failed to check balances for nomenclature', item?.ref, err);
        return null;
      }
    }));
    kept.push(...checks.filter(Boolean));
  }
  return kept;
}

export default function EquipmentDetailWarehouse1CTab({
  data,
  active,
  detailLoading = false,
  buildReturnContext = null,
}) {
  const navigate = useNavigate();
  const searchPlan = useMemo(() => buildDefaultSearchPlan(data), [data]);
  const defaultSearchText = searchPlan.primaryQuery || searchPlan.fallbackQuery || '';
  const invNo = String(readFirst(data, ['INV_NO', 'inv_no'], '')).trim();

  const [searchText, setSearchText] = useState(defaultSearchText);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [triedQuery, setTriedQuery] = useState('');
  const [rawResultCount, setRawResultCount] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState('');
  const [balances, setBalances] = useState([]);
  const [autoLoaded, setAutoLoaded] = useState(false);

  useEffect(() => {
    setSearchText(defaultSearchText);
    setSearchLoading(false);
    setSearchError('');
    setTriedQuery('');
    setRawResultCount(0);
    setSuggestions([]);
    setSelected(null);
    setSelectedWarehouse(null);
    setBalancesLoading(false);
    setBalancesError('');
    setBalances([]);
    setAutoLoaded(false);
  }, [data, defaultSearchText]);

  const applySuggestionResults = useCallback(async (rows, tried) => {
    const list = Array.isArray(rows) ? rows : [];
    setRawResultCount(list.length);
    const filtered = await filterSuggestionsWithPositiveBalances(list);
    setTriedQuery(tried);
    setSuggestions(filtered);
    if (!list.length) {
      setSearchError('Совпадений в 1С не найдено. Уточните запрос вручную.');
      return { found: false, tried, onlyWithStock: false };
    }
    if (!filtered.length) {
      setSearchError('Найдены совпадения в справочнике 1С, но у всех нулевой остаток. Показаны только позиции с ненулевым остатком.');
      return { found: false, tried, onlyWithStock: true };
    }
    setSearchError('');
    return { found: true, tried, onlyWithStock: true };
  }, []);

  const searchNomenclatureFull = useCallback(async (text) => {
    const normalized = String(text || '').trim();
    if (!normalized) return { rows: [], tried: '' };
    const rows = await warehouse1cAPI.searchNomenclature(normalized, NOMENCLATURE_SEARCH_LIMIT);
    return {
      rows: Array.isArray(rows) ? rows : [],
      tried: normalized,
    };
  }, []);

  const runNomenclatureSearch = useCallback(async (text, { allowFallback = false } = {}) => {
    const normalized = String(text || '').trim();
    if (!normalized) {
      setSuggestions([]);
      setTriedQuery('');
      setRawResultCount(0);
      setSearchError('Введите текст для поиска номенклатуры в 1С.');
      return { found: false, tried: '' };
    }

    setSearchLoading(true);
    setSearchError('');
    setSearchText(normalized);
    try {
      const primary = await searchNomenclatureFull(normalized);
      const applied = await applySuggestionResults(primary.rows, primary.tried);
      if (applied.found) {
        return applied;
      }

      if (allowFallback && searchPlan.fallbackQuery) {
        const fallback = String(searchPlan.fallbackQuery).trim();
        if (fallback && fallback !== normalized) {
          setSearchError(`По парт. номеру «${normalized}» ничего с остатком не найдено. Ищем по модели…`);
          const fallbackResult = await searchNomenclatureFull(fallback);
          setSearchText(fallback);
          const fallbackApplied = await applySuggestionResults(fallbackResult.rows, fallbackResult.tried);
          if (fallbackApplied.found) {
            setSearchError(`По парт. номеру совпадений с остатком нет — показаны результаты по модели «${fallbackResult.tried}».`);
          }
          return fallbackApplied;
        }
      }

      if (!applied.onlyWithStock) {
        const suggestResult = await warehouse1cAPI.suggestNomenclature(normalized, NOMENCLATURE_SEARCH_LIMIT);
        const suggestRows = Array.isArray(suggestResult?.results) ? suggestResult.results : [];
        if (suggestRows.length) {
          const suggestApplied = await applySuggestionResults(
            suggestRows,
            String(suggestResult?.tried_query || normalized),
          );
          if (suggestApplied.found) {
            setSearchError('Точный поиск не дал результатов с остатком — показан умный подбор по похожим названиям.');
            return suggestApplied;
          }
        }
        setSearchError('Совпадений в 1С не найдено. Уточните запрос вручную.');
      }
      return applied;
    } catch (err) {
      console.error('Failed to search nomenclature:', err);
      setSearchError(resolveWarehouseErrorMessage(err, 'Не удалось найти номенклатуру в 1С.'));
      setSuggestions([]);
      setTriedQuery('');
      setRawResultCount(0);
      return { found: false, tried: '' };
    } finally {
      setSearchLoading(false);
    }
  }, [applySuggestionResults, searchNomenclatureFull, searchPlan.fallbackQuery]);

  useEffect(() => {
    if (!active || detailLoading || autoLoaded || !defaultSearchText) return;
    setAutoLoaded(true);
    void runNomenclatureSearch(defaultSearchText, {
      allowFallback: searchPlan.preferredSource === 'part_no',
    });
  }, [
    active,
    autoLoaded,
    defaultSearchText,
    detailLoading,
    runNomenclatureSearch,
    searchPlan.preferredSource,
  ]);

  const loadBalances = useCallback(async (item) => {
    if (!item?.ref) return;
    setSelected(item);
    setSelectedWarehouse(null);
    setBalancesLoading(true);
    setBalancesError('');
    try {
      const rows = await warehouse1cAPI.getBalances({ nomenclatureRef: item.ref, limit: 200 });
      setBalances(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load balances for nomenclature:', err);
      setBalancesError(resolveWarehouseErrorMessage(err, 'Не удалось загрузить остатки по номенклатуре.'));
      setBalances([]);
    } finally {
      setBalancesLoading(false);
    }
  }, []);

  const openWarehousePage = useCallback((warehouseRow = null) => {
    if (!selected?.ref) return;
    const params = new URLSearchParams({
      tab: 'balances',
      nomenclatureRef: selected.ref,
      nomenclatureName: selected.name || '',
      nomenclatureCode: selected.code || '',
    });
    const warehouseRef = warehouseRow?.warehouse_ref || selectedWarehouse?.ref || '';
    const warehouseName = warehouseRow?.warehouse_name || selectedWarehouse?.name || '';
    if (isMeaningful1cRef(warehouseRef)) {
      params.set('warehouseRef', warehouseRef);
      if (warehouseName) params.set('warehouseName', warehouseName);
    }
    const fallbackState = {
      returnTo: '/database',
      returnLabel: invNo ? 'Назад к карточке' : 'Назад в Инвентарь',
      reopenDetail: invNo
        ? {
          kind: 'equipment',
          invNo,
          detailTab: 'warehouse1c',
          detailSnapshot: data || null,
        }
        : null,
    };
    const state = typeof buildReturnContext === 'function'
      ? buildReturnContext({
        returnLabel: fallbackState.returnLabel,
        reopenDetail: fallbackState.reopenDetail,
      })
      : fallbackState;
    navigate(`/warehouse-1c?${params.toString()}`, { state });
  }, [buildReturnContext, data, navigate, selected, selectedWarehouse, invNo]);

  const autoSearchHint = searchPlan.preferredSource === 'part_no'
    ? 'При открытии вкладки сначала ищем по полному парт. номеру из Хаба; если совпадений с остатком нет — по модели. В списке только номенклатура с ненулевым остатком.'
    : 'При открытии вкладки ищем по полной модели из Хаба. В списке только номенклатура с ненулевым остатком.';

  const resultsTruncated = rawResultCount >= NOMENCLATURE_SEARCH_LIMIT;

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {autoSearchHint}
        {' '}
        Кнопка «Найти» — поиск по введённому тексту.
      </Alert>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          size="small"
          fullWidth
          label="Поиск в 1С"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Парт. номер, модель или часть названия"
        />
        <Button
          variant="contained"
          startIcon={searchLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
          onClick={() => void runNomenclatureSearch(searchText)}
          disabled={searchLoading || detailLoading}
          sx={{ flexShrink: 0, height: 40 }}
        >
          Найти
        </Button>
      </Stack>

      {detailLoading ? (
        <Typography variant="body2" color="text.secondary">
          Загрузка данных карточки…
        </Typography>
      ) : null}

      {triedQuery ? (
        <Typography variant="body2" color="text.secondary">
          Показаны совпадения с остатком по запросу «{triedQuery}»
        </Typography>
      ) : null}

      {resultsTruncated ? (
        <Typography variant="body2" color="warning.main">
          Показаны первые {NOMENCLATURE_SEARCH_LIMIT} совпадений — уточните запрос, если нужной позиции нет в списке.
        </Typography>
      ) : null}

      {searchError ? <Alert severity="warning">{searchError}</Alert> : null}

      {suggestions.length > 0 ? (
        <Paper variant="outlined">
          <List dense disablePadding>
            {suggestions.map((item) => (
              <ListItemButton
                key={item.ref}
                selected={selected?.ref === item.ref}
                onClick={() => void loadBalances(item)}
              >
                <ListItemText
                  primary={<NomenclatureCell code={item.code} name={item.name} />}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      ) : null}

      {selected ? (
        <Box>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Остатки по выбранной номенклатуре
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={() => openWarehousePage()}
            >
              Открыть в Складе 1С
            </Button>
          </Stack>

          {balancesLoading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Загрузка остатков из 1С...
              </Typography>
            </Stack>
          ) : null}

          {balancesError ? <Alert severity="error">{balancesError}</Alert> : null}

          {!balancesLoading && !balancesError && balances.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              На складе нет позиций с ненулевым конечным остатком.
            </Typography>
          ) : null}

          {!balancesLoading && balances.length > 0 ? (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Склад</TableCell>
                    <TableCell align="right">Кол-во</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {balances.map((row, index) => {
                    const selectedRow = selectedWarehouse?.ref === row.warehouse_ref;
                    return (
                      <TableRow
                        key={`${row.warehouse_ref || row.warehouse_name}|${index}`}
                        hover
                        selected={selectedRow}
                        onClick={() => {
                          if (!isMeaningful1cRef(row.warehouse_ref)) return;
                          setSelectedWarehouse({
                            ref: row.warehouse_ref,
                            name: row.warehouse_name || '',
                          });
                        }}
                        onDoubleClick={() => openWarehousePage(row)}
                        sx={{ cursor: isMeaningful1cRef(row.warehouse_ref) ? 'pointer' : 'default' }}
                      >
                        <TableCell>{row.warehouse_name || '-'}</TableCell>
                        <TableCell align="right">{formatWarehouseQty(row.qty_balance)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}
