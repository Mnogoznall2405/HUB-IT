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
// Синяя камера — остались непроверенные фото (даже если часть уже проверена), зелёная — проверены все
// (проверка — кем-то, кроме загрузившего), красная — есть отклонённое фото.
export default function EquipmentPhotoIndicator({ item, size = 18, onOpen = null }) {
  const count = getEquipmentPhotoCount(item);
  if (!count || count <= 0) return null;
  const verified = Math.min(getEquipmentVerifiedPhotoCount(item) || 0, count);
  const rejected = Math.min(getEquipmentRejectedPhotoCount(item) || 0, count);
  const pending = Math.max(count - verified - rejected, 0);
  // Красная — есть отклонённое фото (требует внимания), синяя — остались непроверенные,
  // зелёная — проверены все.
  const state = rejected > 0 ? 'rejected' : pending > 0 ? 'pending' : 'verified';
  const color = state === 'rejected' ? 'error' : state === 'verified' ? 'success' : 'primary';
  // Тёмные оттенки на светлой теме; на тёмной main, иначе камера теряется на фоне.
  const verifiedSx = state === 'rejected'
    ? { color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.error.main : theme.palette.error.dark) }
    : state === 'verified'
      ? { color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.success.main : theme.palette.success.dark) }
      : {};
  let label = `Есть фото: ${count}`;
  if (state === 'rejected') {
    label = `Фото отклонено: ${rejected} из ${count}`;
  } else if (verified > 0 && pending > 0) {
    label = `Проверено ${verified} из ${count}, не проверено: ${pending}`;
  } else if (state === 'verified') {
    label = `Фото проверены: ${verified} из ${count}`;
  }
  const ariaLabel = state === 'rejected'
    ? `Открыть фото: ${count}, отклонено ${rejected}`
    : verified > 0
      ? `Открыть фото: ${count}, проверено ${verified}`
      : `Открыть фото: ${count}`;

  if (!onOpen) {
    return (
      <Tooltip title={label} arrow>
        <PhotoCameraOutlinedIcon
          color={color}
          data-photo-state={state}
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
        aria-label={ariaLabel}
        data-photo-state={state}
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
