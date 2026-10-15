import { memo } from 'react';
import { Badge, Box, Button, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import RuleFolderOutlinedIcon from '@mui/icons-material/RuleFolderOutlined';

import {
  ACT_FILTER_ALL,
  ACT_FILTER_WITH,
  ACT_FILTER_WITHOUT,
  PHOTO_FILTER_ALL,
  PHOTO_FILTER_REJECTED,
  PHOTO_FILTER_UNCHECKED,
  PHOTO_FILTER_WITH,
  PHOTO_FILTER_WITHOUT,
} from './databaseListModel';

const groupSx = {
  '& .MuiToggleButton-root': {
    textTransform: 'none',
    py: 0,
    px: 1,
    height: 28,
    fontSize: '0.78rem',
    whiteSpace: 'nowrap',
  },
};

// Фильтры «фото» и «акт» работают по уже загруженным строкам (photo_count и
// current_act_available приходят порциями вместе со списком) — подпись честно
// говорит «среди загруженных».
const ListFilterBar = memo(function ListFilterBar({
  photoValue,
  onPhotoChange,
  photoStats,
  actValue,
  onActChange,
  actStats,
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
  // Тумблеры «Отклонённые»/«Не проверено» видны, когда есть что показать или выбраны.
  const showRejected = rejectedCount > 0 || photoValue === PHOTO_FILTER_REJECTED;
  const showUnchecked = uncheckedCount > 0 || photoValue === PHOTO_FILTER_UNCHECKED;
  const reviewBadge = Number(reviewSummary?.rejected || 0) + Number(reviewSummary?.unchecked || 0);

  return (
    <Box
      data-testid="equipment-list-filters"
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1.5,
        rowGap: 0.5,
        mb: isMobile ? 0.75 : 1,
      }}
    >
      {photo && photo.total > 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary">Фото</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={photoValue}
            onChange={(_event, next) => onPhotoChange(next || PHOTO_FILTER_ALL)}
            aria-label="Фильтр по наличию фото"
            sx={groupSx}
          >
            <ToggleButton value={PHOTO_FILTER_ALL}>Все</ToggleButton>
            <ToggleButton value={PHOTO_FILTER_WITHOUT}>{`Без фото (${photo.withoutPhoto})`}</ToggleButton>
            <ToggleButton value={PHOTO_FILTER_WITH}>{`С фото (${photo.withPhoto})`}</ToggleButton>
            {showRejected ? (
              <ToggleButton value={PHOTO_FILTER_REJECTED}>{`Отклонённые (${rejectedCount})`}</ToggleButton>
            ) : null}
            {showUnchecked ? (
              <ToggleButton value={PHOTO_FILTER_UNCHECKED}>{`Не проверено (${uncheckedCount})`}</ToggleButton>
            ) : null}
          </ToggleButtonGroup>
        </Box>
      ) : null}

      {actStats ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary">Акт</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={actValue}
            onChange={(_event, next) => onActChange(next || ACT_FILTER_ALL)}
            aria-label="Фильтр по наличию акта"
            sx={groupSx}
          >
            <ToggleButton value={ACT_FILTER_ALL}>Все</ToggleButton>
            <ToggleButton value={ACT_FILTER_WITHOUT}>{`Без акта (${actStats.withoutAct})`}</ToggleButton>
            <ToggleButton value={ACT_FILTER_WITH}>{`С актом (${actStats.withAct})`}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      ) : null}

      {photo && photo.total > 0 ? (
        <Typography variant="caption" color="text.secondary">
          {photoKnown > 0 || (actStats && actStats.withAct + actStats.withoutAct > 0)
            ? `среди загруженных${unknown > 0 ? ` · не проверено ${unknown}` : ''}`
            : 'данные ещё загружаются'}
        </Typography>
      ) : null}

      {onOpenQuality ? (
        <Button
          size="small"
          variant="outlined"
          startIcon={<RuleFolderOutlinedIcon />}
          onClick={onOpenQuality}
          data-testid="quality-open"
          sx={{ textTransform: 'none', height: 28, fontSize: '0.78rem' }}
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
            sx={{ textTransform: 'none', height: 28, fontSize: '0.78rem' }}
          >
            Проверка фото
          </Button>
        </Badge>
      ) : null}
    </Box>
  );
});

export default ListFilterBar;
