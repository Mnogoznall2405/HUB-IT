import { memo, useState } from 'react';
import { Badge, Box, Button, Chip, ListItemText, Menu, MenuItem } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import FilterAltOffOutlinedIcon from '@mui/icons-material/FilterAltOffOutlined';
import RuleFolderOutlinedIcon from '@mui/icons-material/RuleFolderOutlined';

import {
  ACT_FILTER_ALL,
  ACT_FILTER_WITH,
  ACT_FILTER_WITHOUT,
  ONE_C_FILTER_ALL,
  ONE_C_FILTER_DIFF,
  ONE_C_FILTER_MANUAL,
  ONE_C_FILTER_MISMATCH,
  ONE_C_FILTER_NO_WAREHOUSE,
  ONE_C_FILTER_NOT_IN_NOMENCLATURE,
  ONE_C_FILTER_SYNCED,
  ONE_C_FILTER_UNSYNCED,
  PHOTO_FILTER_ALL,
  PHOTO_FILTER_REJECTED,
  PHOTO_FILTER_UNCHECKED,
  PHOTO_FILTER_WITH,
  PHOTO_FILTER_WITHOUT,
} from './databaseListModel';

const chipSx = {
  height: 28,
  fontSize: '0.78rem',
  '& .MuiChip-deleteIcon': { fontSize: 20, ml: 0, mr: 0.25 },
};

const buttonSx = { textTransform: 'none', height: 28, fontSize: '0.78rem' };

/**
 * Фильтр-«чип с выпадающим списком»: в покое «Фото: все ▾», с выбранным значением
 * подсвечен и показывает его («Фото: Без фото (12) ▾»). Один клик — список, второй — выбор.
 */
function FilterChip({ label, ariaLabel, value, defaultValue, options, onChange }) {
  const [anchor, setAnchor] = useState(null);
  const current = options.find((option) => option.value === value) || options[0];
  const active = value !== defaultValue;
  const open = (event) => setAnchor(event.currentTarget);
  return (
    <>
      <Chip
        size="small"
        color={active ? 'primary' : 'default'}
        variant={active ? 'filled' : 'outlined'}
        label={`${label}: ${active ? current.label : 'все'}`}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={open}
        onDelete={open}
        deleteIcon={<ArrowDropDownIcon />}
        sx={chipSx}
      />
      <Menu
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 200, backgroundImage: 'none' } } }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === value}
            onClick={() => {
              setAnchor(null);
              onChange(option.value);
            }}
          >
            <ListItemText>{option.label}</ListItemText>
            {option.value === value ? <CheckIcon fontSize="small" sx={{ ml: 1 }} /> : null}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

// Фильтры «фото», «акт» и «1С» работают по уже загруженным строкам (photo_count,
// current_act_available и сводка сверки приходят порциями вместе со списком) —
// подпись честно говорит «среди загруженных».
const ListFilterBar = memo(function ListFilterBar({
  photoValue,
  onPhotoChange,
  photoStats,
  actValue,
  onActChange,
  actStats,
  // Фильтр по сверке с 1С (автоматической и ручной отметке).
  oneCValue = ONE_C_FILTER_ALL,
  onOneCChange = null,
  oneCStats = null,
  isMobile = false,
  // Очередь проверки фото: только для права database.photo_verify.
  onOpenReview = null,
  reviewSummary = null,
  // Панель качества данных (право database.read).
  onOpenQuality = null,
}) {
  const photo = photoStats?.overall;
  if ((!photo || photo.total === 0) && !onOpenReview && !onOpenQuality) return null;

  const photoKnown = photo ? photo.withPhoto + photo.withoutPhoto : 0;
  const unknown = Math.max(photo?.unknown || 0, actStats?.unknown || 0);
  const rejectedCount = photo?.rejected || 0;
  const uncheckedCount = photo?.unchecked || 0;
  // Значения «Отклонённые»/«Не проверено» видны, когда есть что показать или выбраны.
  const showRejected = rejectedCount > 0 || photoValue === PHOTO_FILTER_REJECTED;
  const showUnchecked = uncheckedCount > 0 || photoValue === PHOTO_FILTER_UNCHECKED;
  const reviewBadge = Number(reviewSummary?.rejected || 0) + Number(reviewSummary?.unchecked || 0);

  const photoOptions = photo && photo.total > 0 ? [
    { value: PHOTO_FILTER_ALL, label: 'Все' },
    { value: PHOTO_FILTER_WITHOUT, label: `Без фото (${photo.withoutPhoto})` },
    { value: PHOTO_FILTER_WITH, label: `С фото (${photo.withPhoto})` },
    ...(showRejected ? [{ value: PHOTO_FILTER_REJECTED, label: `Отклонённые (${rejectedCount})` }] : []),
    ...(showUnchecked ? [{ value: PHOTO_FILTER_UNCHECKED, label: `Не проверено (${uncheckedCount})` }] : []),
  ] : null;
  const actOptions = actStats ? [
    { value: ACT_FILTER_ALL, label: 'Все' },
    { value: ACT_FILTER_WITHOUT, label: `Без акта (${actStats.withoutAct})` },
    { value: ACT_FILTER_WITH, label: `С актом (${actStats.withAct})` },
  ] : null;
  const oneCOptions = oneCStats && onOneCChange ? [
    { value: ONE_C_FILTER_ALL, label: 'Все' },
    { value: ONE_C_FILTER_SYNCED, label: `Сверено (${oneCStats.synced})` },
    { value: ONE_C_FILTER_DIFF, label: `Расхождение ≠ (${oneCStats.diff})` },
    { value: ONE_C_FILTER_MANUAL, label: `Вручную ✎ (${oneCStats.manual})` },
    { value: ONE_C_FILTER_MISMATCH, label: `Не сходится ✕ (${oneCStats.mismatch || 0})` },
    { value: ONE_C_FILTER_NOT_IN_NOMENCLATURE, label: `Нет в номенклатуре 1С ? (${oneCStats.missingNomenclature || 0})` },
    { value: ONE_C_FILTER_UNSYNCED, label: `Не сверено (${oneCStats.unsynced})` },
    { value: ONE_C_FILTER_NO_WAREHOUSE, label: `Нет склада в 1С (${oneCStats.noWarehouse || 0})` },
  ] : null;

  const anyActive = Boolean(
    (photoOptions && photoValue !== PHOTO_FILTER_ALL)
    || (actOptions && actValue !== ACT_FILTER_ALL)
    || (oneCOptions && oneCValue !== ONE_C_FILTER_ALL),
  );
  const resetAll = () => {
    if (photoOptions) onPhotoChange(PHOTO_FILTER_ALL);
    if (actOptions) onActChange(ACT_FILTER_ALL);
    if (oneCOptions) onOneCChange(ONE_C_FILTER_ALL);
  };

  return (
    <Box
      data-testid="equipment-list-filters"
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1,
        rowGap: 0.5,
        mb: isMobile ? 0.75 : 1,
      }}
    >
      {photoOptions ? (
        <FilterChip
          label="Фото"
          ariaLabel="Фильтр по наличию фото"
          value={photoValue}
          defaultValue={PHOTO_FILTER_ALL}
          options={photoOptions}
          onChange={onPhotoChange}
        />
      ) : null}

      {actOptions ? (
        <FilterChip
          label="Акт"
          ariaLabel="Фильтр по наличию акта"
          value={actValue}
          defaultValue={ACT_FILTER_ALL}
          options={actOptions}
          onChange={onActChange}
        />
      ) : null}

      {oneCOptions ? (
        <FilterChip
          label="1С"
          ariaLabel="Фильтр по сверке с 1С"
          value={oneCValue}
          defaultValue={ONE_C_FILTER_ALL}
          options={oneCOptions}
          onChange={onOneCChange}
        />
      ) : null}

      {anyActive ? (
        <Button
          size="small"
          startIcon={<FilterAltOffOutlinedIcon />}
          onClick={resetAll}
          data-testid="list-filters-reset"
          sx={buttonSx}
        >
          Сбросить
        </Button>
      ) : null}

      {photo && photo.total > 0 ? (
        <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
          {photoKnown > 0 || (actStats && actStats.withAct + actStats.withoutAct > 0)
            ? `среди загруженных${unknown > 0 ? ` · не проверено ${unknown}` : ''}`
            : 'данные ещё загружаются'}
        </Box>
      ) : null}

      {onOpenQuality || onOpenReview ? (
        <Box sx={{ display: 'flex', gap: 1, ml: isMobile ? 0 : 'auto' }}>
          {onOpenQuality ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<RuleFolderOutlinedIcon />}
              onClick={onOpenQuality}
              data-testid="quality-open"
              sx={buttonSx}
            >
              Качество данных
            </Button>
          ) : null}

          {onOpenReview ? (
            <Badge color="error" badgeContent={reviewBadge} max={999} invisible={reviewBadge <= 0}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FactCheckOutlinedIcon />}
                onClick={onOpenReview}
                data-testid="photo-review-open"
                sx={buttonSx}
              >
                Проверка фото
              </Button>
            </Badge>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
});

export default ListFilterBar;
