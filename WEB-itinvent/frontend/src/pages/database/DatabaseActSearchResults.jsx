import { memo, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';

import { LoadingSpinner } from '../../components/common';
import { API_V1_BASE } from '../../api/client';
import {
  getOfficeEmptyStateSx,
  getOfficeHeaderBandSx,
  getOfficePanelSx,
} from '../../theme/officeUiTokens';
import { readFirst, normalizeDbId } from './databaseRecordModel';

const formatEquipmentItems = (items = []) => {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.inv_no || '').trim())
    .filter(Boolean);
  if (normalized.length === 0) return '-';
  if (normalized.length <= 2) return normalized.join(', ');
  return `${normalized.slice(0, 2).join(', ')} +${normalized.length - 2}`;
};

const DatabaseActSearchResults = memo(function DatabaseActSearchResults({
  query = '',
  results = [],
  loading = false,
  error = '',
  truncated = false,
  formatDate = (value) => value,
  onOpenEquipment,
  onErrorClose,
  theme,
  ui,
}) {
  const [openingDocNo, setOpeningDocNo] = useState('');

  const panelSx = useMemo(
    () => getOfficePanelSx(ui, { borderRadius: '12px', overflow: 'hidden' }),
    [ui]
  );
  const emptyStateSx = useMemo(() => getOfficeEmptyStateSx(ui, { p: 2 }), [ui]);
  const headerBandSx = useMemo(() => getOfficeHeaderBandSx(ui), [ui]);
  const textSecondary = ui?.textSecondary || theme.palette.text.secondary;
  const textPrimary = ui?.textPrimary || theme.palette.text.primary;
  const actionHover = ui?.actionHover || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06);
  const borderSoft = ui?.borderSoft || theme.palette.divider;

  const handleOpenFile = useCallback((act) => {
    const docNo = String(readFirst(act, ['doc_no', 'DOC_NO'], '')).trim();
    if (!docNo) return;

    const firstItem = Array.isArray(act?.items) ? act.items[0] : null;
    const itemId = readFirst(firstItem || {}, ['item_id', 'ITEM_ID'], null);
    const invNo = String(readFirst(firstItem || {}, ['inv_no', 'INV_NO'], '')).trim();

    setOpeningDocNo(docNo);
    try {
      const selectedDb = normalizeDbId(localStorage.getItem('selected_database') || '');
      const requestUrl = new URL(
        `${API_V1_BASE}/equipment/acts/${encodeURIComponent(docNo)}/file`,
        window.location.origin
      );
      if (itemId !== null && itemId !== undefined && itemId !== '') {
        requestUrl.searchParams.set('item_id', String(itemId));
      }
      if (invNo) {
        requestUrl.searchParams.set('inv_no', invNo);
      }
      if (selectedDb) {
        requestUrl.searchParams.set('db_id', selectedDb);
      }
      const opened = window.open(requestUrl.toString(), '_blank', 'noopener,noreferrer');
      if (!opened) {
        window.location.assign(requestUrl.toString());
      }
    } finally {
      setOpeningDocNo('');
    }
  }, []);

  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery.length < 2) {
    return (
      <Paper variant="outlined" sx={{ ...emptyStateSx, mb: 2 }}>
        <Typography variant="body2" sx={{ color: textSecondary }}>
          Введите номер акта, ФИО сотрудника или инв. №
        </Typography>
      </Paper>
    );
  }

  if (loading) {
    return (
      <Paper variant="outlined" sx={{ ...panelSx, mb: 2, p: 2 }}>
        <LoadingSpinner message="Поиск актов..." />
      </Paper>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Paper variant="outlined" sx={panelSx}>
        <Box sx={{ ...headerBandSx, px: 2, py: 1.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>
            Результаты поиска актов
          </Typography>
          <Typography variant="caption" sx={{ color: textSecondary, display: 'block', mt: 0.25 }}>
            Запрос: {normalizedQuery}
          </Typography>
        </Box>

        <Box sx={{ p: 1.5 }}>
          {error ? (
            <Alert severity="error" onClose={onErrorClose} sx={{ mb: 1.5 }}>
              {error}
            </Alert>
          ) : null}

          {truncated ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              Показаны первые 50 актов. Уточните запрос, если нужного документа нет в списке.
            </Alert>
          ) : null}

          {results.length === 0 && !error ? (
            <Box sx={emptyStateSx}>
              <Typography variant="body2" sx={{ color: textSecondary }}>
                Акты не найдены
              </Typography>
            </Box>
          ) : (
            <TableContainer sx={{ borderRadius: '10px', border: '1px solid', borderColor: borderSoft }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={headerBandSx}>
                    <TableCell sx={{ color: textSecondary, fontWeight: 700 }}>№ документа</TableCell>
                    <TableCell sx={{ color: textSecondary, fontWeight: 700 }}>Дата</TableCell>
                    <TableCell sx={{ color: textSecondary, fontWeight: 700 }}>Тип</TableCell>
                    <TableCell sx={{ color: textSecondary, fontWeight: 700 }}>Сотрудник</TableCell>
                    <TableCell sx={{ color: textSecondary, fontWeight: 700 }}>Филиал / Локация</TableCell>
                    <TableCell sx={{ color: textSecondary, fontWeight: 700 }}>Оборудование</TableCell>
                    <TableCell align="right" sx={{ color: textSecondary, fontWeight: 700 }}>Действия</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((act) => {
                    const docNo = String(readFirst(act, ['doc_no', 'DOC_NO'], '')).trim();
                    const docNumber = String(readFirst(act, ['doc_number', 'DOC_NUMBER'], '-')).trim() || '-';
                    const typeName = String(readFirst(act, ['type_name', 'TYPE_NAME'], '-')).trim() || '-';
                    const employeeName = String(readFirst(act, ['employee_name', 'EMPLOYEE_NAME'], '-')).trim() || '-';
                    const branchName = String(readFirst(act, ['branch_name', 'BRANCH_NAME'], '')).trim();
                    const locationName = String(readFirst(act, ['location_name', 'LOCATION_NAME'], '')).trim();
                    const branchLocation = [branchName, locationName].filter(Boolean).join(' / ') || '-';
                    const items = Array.isArray(act?.items) ? act.items : [];
                    const equipmentLabel = formatEquipmentItems(items);
                    const hasFile = Boolean(act?.has_file);
                    const isOpening = openingDocNo === docNo;

                    return (
                      <TableRow
                        key={docNo || docNumber}
                        hover
                        sx={{
                          '&:hover': { bgcolor: actionHover },
                          '& td': { color: textPrimary, borderColor: borderSoft },
                        }}
                      >
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                            <Typography variant="body2" sx={{ fontWeight: 600, color: textPrimary }}>
                              {docNumber}
                            </Typography>
                            {!hasFile ? (
                              <Chip
                                size="small"
                                label="без файла"
                                variant="outlined"
                                sx={{
                                  color: textSecondary,
                                  borderColor: borderSoft,
                                  bgcolor: ui?.panelBg || 'transparent',
                                }}
                              />
                            ) : null}
                          </Stack>
                        </TableCell>
                        <TableCell>{formatDate(readFirst(act, ['doc_date', 'DOC_DATE'], ''))}</TableCell>
                        <TableCell>{typeName}</TableCell>
                        <TableCell>{employeeName}</TableCell>
                        <TableCell>{branchLocation}</TableCell>
                        <TableCell>
                          <Tooltip title={items.map((item) => item?.inv_no).filter(Boolean).join(', ') || '-'}>
                            <Typography variant="body2" noWrap sx={{ maxWidth: 180, color: textPrimary }}>
                              {equipmentLabel}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={0.75} justifyContent="flex-end" useFlexGap flexWrap="wrap">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<DescriptionOutlinedIcon />}
                              disabled={!hasFile || isOpening}
                              onClick={() => handleOpenFile(act)}
                              sx={{
                                borderColor: borderSoft,
                                color: textPrimary,
                                '&:hover': {
                                  borderColor: alpha(theme.palette.primary.main, 0.45),
                                  bgcolor: actionHover,
                                },
                              }}
                            >
                              Файл
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<Inventory2OutlinedIcon />}
                              disabled={items.length === 0}
                              onClick={() => onOpenEquipment?.(act, items)}
                            >
                              Оборудование
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Paper>
    </Box>
  );
});

export default DatabaseActSearchResults;
