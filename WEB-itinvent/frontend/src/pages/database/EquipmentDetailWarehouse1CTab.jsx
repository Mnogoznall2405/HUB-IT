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

import EmploymentStatusChip from '../../components/EmploymentStatusChip';
import {
  isMeaningful1cRef,
  isWarehouse1cListIncomplete,
  normalizeWarehouse1cListResponse,
  warehouse1cAPI,
} from '../../api/warehouse1c';
import { readFirst } from './databaseRecordModel';
import EmployeeNameLink from './EmployeeNameLink';
import {
  filterBalancesByText,
  formatWarehouseQty,
  isUsableHubPartNo,
  NomenclatureCell,
  resolveWarehouseErrorMessage,
  sortBalancesByWarehouse,
} from './warehouse1cShared';

const NOMENCLATURE_SEARCH_LIMIT = 50;
const BALANCE_BATCH_PER_NOMENCLATURE_LIMIT = 20;

function isUsablePartNo(value) {
  return isUsableHubPartNo(value);
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

export async function filterSuggestionsWithPositiveBalances(items) {
  const list = Array.isArray(items) ? items.filter((item) => isMeaningful1cRef(item?.ref)) : [];
  if (!list.length) return { items: [], hasUnverified: false };

  const refs = Array.from(new Set(list.map((item) => String(item.ref).trim())));
  const requestedRefs = refs.slice(0, NOMENCLATURE_SEARCH_LIMIT);
  const unqueriedRefs = new Set(refs.slice(NOMENCLATURE_SEARCH_LIMIT));

  try {
    const data = await warehouse1cAPI.getBalancesBatch({
      nomenclatureRefs: requestedRefs,
      limitPerNomenclature: BALANCE_BATCH_PER_NOMENCLATURE_LIMIT,
    });
    const response = normalizeWarehouse1cListResponse(data);
    const responseIsIndeterminate = isWarehouse1cListIncomplete(response.meta)
      || response.items.some((row) => isWarehouse1cListIncomplete(row));
    if (responseIsIndeterminate) {
      // A timeout/truncation is not evidence of a zero balance.  Preserve all
      // candidates for manual selection and make the uncertainty visible.
      return { items: list, hasUnverified: true };
    }

    const refsWithPositiveBalance = new Set(
      response.items
        .filter((row) => Number(row?.qty_1c_total ?? row?.qty_balance ?? 0) > 0)
        .map((row) => String(row?.nomenclature_ref || '').trim())
        .filter(Boolean),
    );
    return {
      items: list.filter((item) => {
        const ref = String(item.ref).trim();
        return refsWithPositiveBalance.has(ref) || unqueriedRefs.has(ref);
      }),
      hasUnverified: unqueriedRefs.size > 0,
    };
  } catch (err) {
    console.warn('Failed to batch-check 1C balances for nomenclature suggestions', err);
    // The batch is deliberately all-or-nothing: a failed read must keep the
    // candidates available rather than silently filtering them as zero stock.
    return { items: list, hasUnverified: true };
  }
}

function BalancesMetadataNotice({ meta }) {
  if (!isWarehouse1cListIncomplete(meta)) return null;

  const status = String(meta?.status || '').trim().toLowerCase();
  const message = status === 'error' || status === 'unknown'
    ? 'Не удалось подтвердить полноту остатков 1С. Это не означает, что остаток равен нулю.'
    : 'Показана неполная выборка остатков 1С. Не используйте её как итоговую сверку.';

  return <Alert severity="warning">{message}</Alert>;
}

function formatWarehouseTimestamp(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ru-RU');
}

export default function EquipmentDetailWarehouse1CTab({
  data,
  active,
  detailLoading = false,
  buildReturnContext = null,
  onOpenEmployee = null,
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
  const [balancesMeta, setBalancesMeta] = useState({});
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [hubQuerySource, setHubQuerySource] = useState(searchPlan.preferredSource || 'model');
  const [warehouseFilterText, setWarehouseFilterText] = useState('');

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
    setBalancesMeta({});
    setAutoLoaded(false);
    setHubQuerySource(searchPlan.preferredSource || 'model');
    setWarehouseFilterText('');
  }, [data, defaultSearchText, searchPlan.preferredSource]);

  const visibleWarehouseBalances = useMemo(
    () => filterBalancesByText(balances, warehouseFilterText),
    [balances, warehouseFilterText],
  );
  const balancesIncomplete = isWarehouse1cListIncomplete(balancesMeta);

  const applySuggestionResults = useCallback(async (rows, tried) => {
    const list = Array.isArray(rows) ? rows : [];
    setRawResultCount(list.length);
    const filteredResult = await filterSuggestionsWithPositiveBalances(list);
    const filtered = filteredResult.items;
    setTriedQuery(tried);
    setSuggestions(filtered);
    if (!list.length) {
      setSearchError('Совпадений в 1С не найдено. Уточните запрос вручную.');
      return { found: false, tried, onlyWithStock: false };
    }
    if (!filtered.length) {
      if (filteredResult.hasUnverified) {
        setSearchError('Не удалось подтвердить остатки части номенклатуры 1С. Это не означает нулевой остаток — выберите позицию и повторите запрос.');
        return { found: false, tried, onlyWithStock: false };
      }
      setSearchError('Найдены совпадения в справочнике 1С, но у всех нулевой остаток. Показаны только позиции с ненулевым остатком.');
      return { found: false, tried, onlyWithStock: true };
    }
    setSearchError(filteredResult.hasUnverified
      ? 'Часть позиций показана без проверки остатка: 1С вернула неполный ответ или не ответила вовремя.'
      : '');
    return { found: true, tried, onlyWithStock: true };
  }, []);

  const searchNomenclatureFull = useCallback(async (text) => {
    const normalized = String(text || '').trim();
    if (!normalized) return { rows: [], tried: '' };
    const response = normalizeWarehouse1cListResponse(
      await warehouse1cAPI.searchNomenclature(normalized, NOMENCLATURE_SEARCH_LIMIT),
    );
    return {
      rows: response.items,
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

      setHubQuerySource(
        allowFallback && searchPlan.preferredSource === 'part_no' ? 'part_no' : 'model'
      );

      if (allowFallback && searchPlan.fallbackQuery) {
        const fallback = String(searchPlan.fallbackQuery).trim();
        if (fallback && fallback !== normalized) {
          setSearchError(`По парт. номеру «${normalized}» ничего с остатком не найдено. Ищем по модели…`);
          const fallbackResult = await searchNomenclatureFull(fallback);
          setSearchText(fallback);
          const fallbackApplied = await applySuggestionResults(fallbackResult.rows, fallbackResult.tried);
          if (fallbackApplied.found) {
            setHubQuerySource('model');
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
  }, [
    applySuggestionResults,
    searchNomenclatureFull,
    searchPlan.fallbackQuery,
    searchPlan.preferredSource,
  ]);

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
    setBalancesMeta({});
    const cardPartNo = String(readFirst(data, ['PART_NO', 'part_no'], '')).trim();
    const nomenclatureCode = String(item?.code || '').trim();
    const cardModelName = buildModelSearchText(data);
    const hubQuery = String(triedQuery || searchText || defaultSearchText || '').trim();
    // Парт. № для Хаба: карточка и/или код выбранной номенклатуры 1С.
    const usableCardPart = isUsablePartNo(cardPartNo) ? cardPartNo : '';
    const usableNomenclaturePart = isUsablePartNo(nomenclatureCode) ? nomenclatureCode : '';
    const modelName = cardModelName || (hubQuerySource === 'model' ? hubQuery : '');
    const source = (usableCardPart || usableNomenclaturePart) ? 'part_no' : 'model';
    try {
      const data = await warehouse1cAPI.getBalancesWithHub({
        nomenclatureRef: item.ref,
        partNo: usableCardPart,
        nomenclatureCode: usableNomenclaturePart,
        modelName,
        hubQuery,
        hubQuerySource: source,
        limit: 200,
      });
      const response = normalizeWarehouse1cListResponse(data);
      setBalances(sortBalancesByWarehouse(response.items));
      setBalancesMeta(response.meta);
    } catch (err) {
      console.error('Failed to load balances for nomenclature:', err);
      setBalancesError(resolveWarehouseErrorMessage(err, 'Не удалось загрузить остатки по номенклатуре.'));
      setBalances([]);
      setBalancesMeta({});
    } finally {
      setBalancesLoading(false);
    }
  }, [
    data,
    defaultSearchText,
    hubQuerySource,
    searchText,
    triedQuery,
  ]);

  const openWarehousePage = useCallback((warehouseRow = null) => {
    const warehouseRef = warehouseRow?.warehouse_ref || selectedWarehouse?.ref || '';
    const warehouseName = warehouseRow?.warehouse_name || selectedWarehouse?.name || '';
    const openPersonWarehouse = Boolean(warehouseRow && isMeaningful1cRef(warehouseRef));

    // Склад конкретного человека — открываем с фильтром только по этому складу
    // (вся номенклатура склада, по алфавиту на стороне списка остатков).
    if (openPersonWarehouse) {
      const params = new URLSearchParams({
        tab: 'balances',
        warehouseRef,
      });
      if (warehouseName) params.set('warehouseName', warehouseName);
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
      return;
    }

    if (!selected?.ref) return;
    const params = new URLSearchParams({
      tab: 'balances',
      nomenclatureRef: selected.ref,
      nomenclatureName: selected.name || '',
      nomenclatureCode: selected.code || '',
    });
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
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }} useFlexGap flexWrap="wrap">
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Остатки по выбранной номенклатуре
              </Typography>
              <Typography variant="caption" color="text.secondary">
                В Хабе: совпадение парт. № (карточка / код номенклатуры 1С); если у единицы
                парт. № нет — по модели. С другим парт. № не считаем. Статус сотрудника — по
                адресной книге. Клик по ФИО открывает карточку сотрудника.
              </Typography>
              {balancesMeta?.asOf ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  Данные 1С на: {formatWarehouseTimestamp(balancesMeta.asOf)}
                </Typography>
              ) : null}
            </Box>
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
          {!balancesLoading && !balancesError ? <BalancesMetadataNotice meta={balancesMeta} /> : null}

          {!balancesLoading && !balancesError && !balancesIncomplete && balances.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              На складе нет позиций с ненулевым конечным остатком.
            </Typography>
          ) : null}

          {!balancesLoading && balances.length > 0 ? (
            <Stack spacing={1}>
              <TextField
                size="small"
                fullWidth
                label="Фильтр по складу / сотруднику"
                placeholder="ФИО или название склада"
                value={warehouseFilterText}
                onChange={(event) => setWarehouseFilterText(event.target.value)}
              />
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Склад / сотрудник</TableCell>
                      <TableCell align="right">В 1С</TableCell>
                      <TableCell align="right">В Хабе</TableCell>
                      <TableCell>Сотрудник</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleWarehouseBalances.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">
                            По фильтру ничего не найдено.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {visibleWarehouseBalances.map((row, index) => {
                    const selectedRow = selectedWarehouse?.ref === row.warehouse_ref;
                    const hubCount = row?.hub_count;
                    const hubCountLabel = hubCount === null || hubCount === undefined
                      ? '—'
                      : String(hubCount);
                    const hubOwnerNo = row?.hub_owner_no ?? null;
                    const employeeDisplayName = String(
                      row.hub_employee_name || row.warehouse_name || '',
                    ).trim();
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
                        <TableCell>
                          <Stack spacing={0.25}>
                            {hubOwnerNo ? (
                              <EmployeeNameLink
                                name={row.warehouse_name || employeeDisplayName}
                                ownerNo={hubOwnerNo}
                                onOpenEmployee={onOpenEmployee}
                                variant="body2"
                              />
                            ) : (
                              <Typography variant="body2">{row.warehouse_name || '-'}</Typography>
                            )}
                            {row.hub_employee_name
                              && row.hub_employee_name !== row.warehouse_name ? (
                              <EmployeeNameLink
                                name={row.hub_employee_name}
                                ownerNo={hubOwnerNo}
                                onOpenEmployee={onOpenEmployee}
                                variant="caption"
                                sx={{ color: 'text.secondary' }}
                              />
                            ) : null}
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{formatWarehouseQty(row.qty_balance)}</TableCell>
                        <TableCell align="right">{hubCountLabel}</TableCell>
                        <TableCell>
                          <EmploymentStatusChip
                            status={row.employment_status}
                            label={row.employment_label}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}
