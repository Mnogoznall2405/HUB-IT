import { memo, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
  alpha,
} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import DocumentPreviewDialog from '../../components/documentPreview/DocumentPreviewDialog';
import { LoadingSpinner } from '../../components/common';
import {
  getOfficeEmptyStateSx,
  getOfficeHeaderBandSx,
  getOfficePanelSx,
} from '../../theme/officeUiTokens';
import { readFirst } from './databaseRecordModel';
import { useEquipmentActFilePreview } from './useEquipmentActFilePreview';

function getActKey(act) {
  return String(readFirst(act, ['doc_no', 'DOC_NO'], '') || readFirst(act, ['doc_number', 'DOC_NUMBER'], '')).trim();
}

function normalizeActItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      invNo: String(item?.inv_no || '').trim(),
      modelName: String(item?.model_name || '').trim(),
      serialNo: String(item?.serial_no || '').trim(),
      itemId: item?.item_id,
    }))
    .filter((item) => item.invNo);
}

const DatabaseActSearchResults = memo(function DatabaseActSearchResults({
  query = '',
  results = [],
  loading = false,
  error = '',
  truncated = false,
  formatDate = (value) => value,
  onOpenEquipment,
  onPrefetchEquipment = null,
  onErrorClose,
  theme,
  ui,
}) {
  const { preview, openingDocNo, openActFile, closePreview } = useEquipmentActFilePreview();
  const [selectedKey, setSelectedKey] = useState('');

  const panelSx = getOfficePanelSx(ui, { borderRadius: '12px', overflow: 'hidden' });
  const emptyStateSx = getOfficeEmptyStateSx(ui, { p: 2 });
  const headerBandSx = getOfficeHeaderBandSx(ui);
  const textSecondary = ui?.textSecondary || theme.palette.text.secondary;
  const textPrimary = ui?.textPrimary || theme.palette.text.primary;
  const actionHover = ui?.actionHover || alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.06);
  const borderSoft = ui?.borderSoft || theme.palette.divider;
  const selectedBg = ui?.selectedBg || alpha(theme.palette.primary.main, 0.16);
  const selectedBorder = ui?.selectedBorder || alpha(theme.palette.primary.main, 0.35);
  const panelInset = ui?.panelInset || theme.palette.action.hover;

  const acts = useMemo(() => (Array.isArray(results) ? results : []), [results]);

  useEffect(() => {
    if (!acts.length) {
      setSelectedKey('');
      return;
    }
    const stillExists = acts.some((act) => getActKey(act) === selectedKey);
    if (!stillExists) {
      setSelectedKey(getActKey(acts[0]));
    }
  }, [acts, selectedKey]);

  const selectedAct = useMemo(
    () => acts.find((act) => getActKey(act) === selectedKey) || null,
    [acts, selectedKey],
  );
  const selectedItems = useMemo(
    () => normalizeActItems(selectedAct?.items),
    [selectedAct],
  );

  // Prefetch карточек оборудования выбранного акта — открытие без ожидания.
  useEffect(() => {
    if (!selectedItems.length || typeof onPrefetchEquipment !== 'function') return undefined;
    const invNos = selectedItems.map((item) => item.invNo);
    const timer = window.setTimeout(() => {
      void onPrefetchEquipment(invNos);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onPrefetchEquipment, selectedItems]);

  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery.length < 2) {
    return (
      <Paper variant="outlined" sx={{ ...emptyStateSx, mb: 2 }}>
        <Typography variant="body2" sx={{ color: textSecondary }}>
          Введите номер акта или фамилию сотрудника
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

  const selectedDocNo = selectedAct
    ? String(readFirst(selectedAct, ['doc_no', 'DOC_NO'], '')).trim()
    : '';
  const selectedDocNumber = selectedAct
    ? (String(readFirst(selectedAct, ['doc_number', 'DOC_NUMBER'], '-')).trim() || '-')
    : '';
  const selectedHasFile = Boolean(selectedAct?.has_file);
  const isOpeningSelected = Boolean(
    selectedDocNo
    && (openingDocNo === selectedDocNo || (preview.loading && preview.open)),
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Paper variant="outlined" sx={panelSx}>
        <Box sx={{ ...headerBandSx, px: 2, py: 1.25 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.5}
            alignItems={{ sm: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>
                Результаты поиска актов
              </Typography>
              <Typography variant="caption" sx={{ color: textSecondary, display: 'block', mt: 0.25 }}>
                Запрос: {normalizedQuery}
                {acts.length ? ` · найдено ${acts.length}` : ''}
              </Typography>
            </Box>
            {selectedAct && selectedHasFile ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<DescriptionOutlinedIcon />}
                disabled={isOpeningSelected}
                onClick={() => void openActFile(selectedAct)}
                sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}
              >
                Открыть файл акта
              </Button>
            ) : null}
          </Stack>
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

          {acts.length === 0 && !error ? (
            <Box sx={emptyStateSx}>
              <Typography variant="body2" sx={{ color: textSecondary }}>
                Акты не найдены
              </Typography>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 38%) 1fr' },
                gap: 1.5,
                minHeight: { md: 360 },
              }}
            >
              <Paper
                variant="outlined"
                sx={{
                  borderColor: borderSoft,
                  borderRadius: '10px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  bgcolor: ui?.panelBg || 'transparent',
                }}
              >
                <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: borderSoft }}>
                  <Typography variant="caption" sx={{ color: textSecondary, fontWeight: 700, letterSpacing: 0.3 }}>
                    АКТЫ
                  </Typography>
                </Box>
                <List dense disablePadding sx={{ overflow: 'auto', maxHeight: { xs: 280, md: 480 } }}>
                  {acts.map((act) => {
                    const key = getActKey(act);
                    const docNumber = String(readFirst(act, ['doc_number', 'DOC_NUMBER'], '-')).trim() || '-';
                    const employeeName = String(readFirst(act, ['employee_name', 'EMPLOYEE_NAME'], '')).trim();
                    const branchName = String(readFirst(act, ['branch_name', 'BRANCH_NAME'], '')).trim();
                    const locationName = String(readFirst(act, ['location_name', 'LOCATION_NAME'], '')).trim();
                    const place = [branchName, locationName].filter(Boolean).join(' / ');
                    const itemsCount = normalizeActItems(act?.items).length;
                    const hasFile = Boolean(act?.has_file);
                    const selected = key === selectedKey;
                    const secondaryParts = [
                      formatDate(readFirst(act, ['doc_date', 'DOC_DATE'], '')),
                      place || null,
                      employeeName || null,
                    ].filter(Boolean);

                    return (
                      <ListItemButton
                        key={key || docNumber}
                        selected={selected}
                        onClick={() => setSelectedKey(key)}
                        sx={{
                          alignItems: 'flex-start',
                          py: 1.1,
                          px: 1.5,
                          borderLeft: '3px solid',
                          borderLeftColor: selected ? theme.palette.primary.main : 'transparent',
                          bgcolor: selected ? selectedBg : 'transparent',
                          '&.Mui-selected': {
                            bgcolor: selectedBg,
                          },
                          '&.Mui-selected:hover': {
                            bgcolor: selectedBg,
                          },
                          '&:hover': { bgcolor: actionHover },
                        }}
                      >
                        <ListItemText
                          primary={(
                            <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                              <Typography variant="body2" sx={{ fontWeight: 700, color: textPrimary }}>
                                {docNumber}
                              </Typography>
                              <Chip
                                size="small"
                                label={`${itemsCount} поз.`}
                                sx={{
                                  height: 22,
                                  color: textSecondary,
                                  borderColor: borderSoft,
                                  bgcolor: panelInset,
                                }}
                                variant="outlined"
                              />
                              {!hasFile ? (
                                <Chip
                                  size="small"
                                  label="без файла"
                                  variant="outlined"
                                  sx={{
                                    height: 22,
                                    color: textSecondary,
                                    borderColor: borderSoft,
                                  }}
                                />
                              ) : null}
                            </Stack>
                          )}
                          secondary={(
                            <Typography variant="caption" sx={{ color: textSecondary, display: 'block', mt: 0.35 }}>
                              {secondaryParts.join(' · ') || '—'}
                            </Typography>
                          )}
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              </Paper>

              <Paper
                variant="outlined"
                sx={{
                  borderColor: selectedAct ? selectedBorder : borderSoft,
                  borderRadius: '10px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: { xs: 240, md: 'auto' },
                }}
              >
                <Box sx={{ px: 1.75, py: 1.25, borderBottom: '1px solid', borderColor: borderSoft }}>
                  {selectedAct ? (
                    <Stack spacing={0.35}>
                      <Typography variant="caption" sx={{ color: textSecondary, fontWeight: 700, letterSpacing: 0.3 }}>
                        ОБОРУДОВАНИЕ АКТА
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: textPrimary }}>
                        {selectedDocNumber}
                      </Typography>
                      <Typography variant="caption" sx={{ color: textSecondary }}>
                        {[
                          formatDate(readFirst(selectedAct, ['doc_date', 'DOC_DATE'], '')),
                          [
                            String(readFirst(selectedAct, ['branch_name', 'BRANCH_NAME'], '')).trim(),
                            String(readFirst(selectedAct, ['location_name', 'LOCATION_NAME'], '')).trim(),
                          ].filter(Boolean).join(' / ') || null,
                          String(readFirst(selectedAct, ['employee_name', 'EMPLOYEE_NAME'], '')).trim() || null,
                        ].filter(Boolean).join(' · ') || '—'}
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" sx={{ color: textSecondary }}>
                      Выберите акт слева
                    </Typography>
                  )}
                </Box>

                <Box sx={{ p: 1.25, flex: 1, overflow: 'auto', maxHeight: { xs: 360, md: 480 } }}>
                  {!selectedAct ? (
                    <Box sx={{ ...emptyStateSx, border: 'none' }}>
                      <Typography variant="body2" sx={{ color: textSecondary }}>
                        Выберите акт, чтобы увидеть оборудование
                      </Typography>
                    </Box>
                  ) : selectedItems.length === 0 ? (
                    <Box sx={{ ...emptyStateSx, border: 'none' }}>
                      <Typography variant="body2" sx={{ color: textSecondary }}>
                        В акте нет позиций оборудования
                      </Typography>
                    </Box>
                  ) : (
                    <Stack spacing={1} divider={<Divider flexItem sx={{ borderColor: borderSoft }} />}>
                      {selectedItems.map((item) => (
                        <Stack
                          key={`${item.itemId || item.invNo}|${item.invNo}`}
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1}
                          alignItems={{ sm: 'center' }}
                          justifyContent="space-between"
                          sx={{
                            px: 1,
                            py: 0.85,
                            borderRadius: '8px',
                            '&:hover': { bgcolor: actionHover },
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
                            <Inventory2OutlinedIcon
                              fontSize="small"
                              sx={{ color: textSecondary, mt: 0.25, flexShrink: 0 }}
                            />
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700, color: textPrimary }}>
                                {item.invNo}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: textSecondary,
                                  display: 'block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {[item.modelName, item.serialNo ? `S/N ${item.serialNo}` : '']
                                  .filter(Boolean)
                                  .join(' · ') || 'Модель не указана'}
                              </Typography>
                            </Box>
                          </Stack>
                          <Button
                            size="small"
                            variant="outlined"
                            endIcon={<OpenInNewIcon />}
                            onClick={() => onOpenEquipment?.(item.invNo, item)}
                            sx={{
                              flexShrink: 0,
                              borderColor: borderSoft,
                              color: textPrimary,
                              alignSelf: { xs: 'stretch', sm: 'center' },
                              '&:hover': {
                                borderColor: alpha(theme.palette.primary.main, 0.45),
                                bgcolor: actionHover,
                              },
                            }}
                          >
                            Открыть
                          </Button>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Box>

                {selectedAct && !selectedHasFile ? (
                  <Box sx={{ px: 1.75, py: 1, borderTop: '1px solid', borderColor: borderSoft }}>
                    <Typography variant="caption" sx={{ color: textSecondary }}>
                      Файл акта не прикреплён
                    </Typography>
                  </Box>
                ) : null}
              </Paper>
            </Box>
          )}
        </Box>
      </Paper>

      <DocumentPreviewDialog
        open={preview.open}
        title={preview.title}
        subtitle={preview.subtitle}
        kind={preview.kind}
        objectUrl={preview.objectUrl}
        loading={preview.loading}
        error={preview.error}
        onClose={closePreview}
        onDownloadOriginal={preview.previewBlob ? () => {
          const url = preview.objectUrl;
          if (!url) return;
          const link = document.createElement('a');
          link.href = url;
          link.download = preview.title || 'act.pdf';
          link.click();
        } : undefined}
        canDownloadOriginal={Boolean(preview.previewBlob)}
      />
    </Box>
  );
});

export default DatabaseActSearchResults;
