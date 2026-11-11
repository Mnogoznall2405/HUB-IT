import { Chip, Stack, Tooltip } from '@mui/material';
import { absenceChipColor, formatAbsenceLabel, formatDate } from './addressBookUtils';

export default function AddressBookAbsenceMarks({ item, compact = false }) {
  const zupLabel = formatAbsenceLabel(item?.absence);
  const records = Array.isArray(item?.docflow_absences) ? item.docflow_absences : [];
  if (!zupLabel && !records.length) return null;
  const chipSx = compact
    ? { maxWidth: '100%', height: 22, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem', fontWeight: 700 } }
    : { maxWidth: '100%', fontWeight: 700 };
  return (
    <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.5} sx={{ mt: compact ? 0.35 : 0.5 }}>
      {zupLabel ? (
        <Tooltip title="Источник: 1С:ЗУП">
          <Chip size="small" color={absenceChipColor(item.absence)} label={compact && !records.length ? zupLabel : `ЗУП · ${zupLabel}`} sx={chipSx} data-testid={compact ? 'address-book-zup-row-mark' : 'address-book-absence-chip'} />
        </Tooltip>
      ) : null}
      {records.map((record) => {
        const period = record.ends_on ? ` · до ${formatDate(record.ends_on)}` : '';
        const label = `${record.label || 'Отсутствует'}${period} · ДО`;
        const details = [
          'Источник: 1С:Документооборот',
          record.ends_on ? 'Последний день отсутствия включительно' : '',
          record.differences?.length ? 'Данные отличаются от ЗУП' : '',
        ].filter(Boolean).join('. ');
        return (
          <Tooltip key={record.id} title={details}>
            <Chip size="small" color={absenceChipColor(record)} variant="outlined" label={label} aria-label={`${label}. ${details}`} sx={chipSx} data-testid="address-book-docflow-absence-mark" />
          </Tooltip>
        );
      })}
    </Stack>
  );
}
