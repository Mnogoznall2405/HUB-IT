import { IconButton, Tooltip } from '@mui/material';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';

import { readFirst } from './databaseRecordModel';

// photo_count arrives lazily with the current-acts batch: null/undefined means
// "unknown yet" and must render nothing, never a "no photo" mark.
export const getEquipmentPhotoCount = (item) => {
  const raw = readFirst(item, ['photo_count', 'PHOTO_COUNT'], null);
  if (raw === null || raw === undefined || raw === '') return null;
  const count = Number(raw);
  return Number.isFinite(count) ? count : null;
};

// Сколько фото проверено; null — неизвестно (отметка ещё не включена), не «нет».
export const getEquipmentVerifiedPhotoCount = (item) => {
  const raw = readFirst(item, ['photo_verified_count', 'PHOTO_VERIFIED_COUNT'], null);
  if (raw === null || raw === undefined || raw === '') return null;
  const count = Number(raw);
  return Number.isFinite(count) ? count : null;
};

export const getEquipmentRejectedPhotoCount = (item) => {
  const raw = readFirst(item, ['photo_rejected_count', 'PHOTO_REJECTED_COUNT'], null);
  if (raw === null || raw === undefined || raw === '') return null;
  const count = Number(raw);
  return Number.isFinite(count) ? count : null;
};

// onOpen: клик по камере открывает карточку сразу на вкладке «Фото».
// Зелёная камера — хотя бы одно фото проверено кем-то, кроме загрузившего.
export default function EquipmentPhotoIndicator({ item, size = 18, onOpen = null }) {
  const count = getEquipmentPhotoCount(item);
  if (!count || count <= 0) return null;
  const verified = Math.min(getEquipmentVerifiedPhotoCount(item) || 0, count);
  const rejected = Math.min(getEquipmentRejectedPhotoCount(item) || 0, count);
  // Красная — есть отклонённое фото (требует внимания), зелёная — есть проверенное.
  const color = rejected > 0 ? 'error' : verified > 0 ? 'success' : 'primary';
  // Тёмные оттенки на светлой теме; на тёмной main, иначе камера теряется на фоне.
  const verifiedSx = rejected > 0
    ? { color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.error.main : theme.palette.error.dark) }
    : verified > 0
      ? { color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.success.main : theme.palette.success.dark) }
      : {};
  let label = `Есть фото: ${count}`;
  if (rejected > 0) {
    label = `Фото отклонено: ${rejected} из ${count}`;
  } else if (verified > 0) {
    label = `Фото проверено: ${verified} из ${count}`;
  }

  if (!onOpen) {
    return (
      <Tooltip title={label} arrow>
        <PhotoCameraOutlinedIcon
          color={color}
          titleAccess={label}
          sx={{ fontSize: size, display: 'block', ...verifiedSx }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={`${label} — открыть`} arrow>
      <IconButton
        size="small"
        color={color}
        aria-label={rejected > 0
          ? `Открыть фото: ${count}, отклонено ${rejected}`
          : verified > 0 ? `Открыть фото: ${count}, проверено ${verified}` : `Открыть фото: ${count}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(item);
        }}
        sx={{ p: 0.25, ...verifiedSx }}
      >
        <PhotoCameraOutlinedIcon sx={{ fontSize: size, display: 'block' }} />
      </IconButton>
    </Tooltip>
  );
}
