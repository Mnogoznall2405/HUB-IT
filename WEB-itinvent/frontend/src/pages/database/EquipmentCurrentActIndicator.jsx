import { CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

import { readFirst } from './databaseRecordModel';

const isTrue = (value) => value === true || value === 1 || value === '1' || value === 'true';
const isFalse = (value) => value === false || value === 0 || value === '0' || value === 'false';

const formatActDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

export const buildCurrentEquipmentAct = (item = {}) => {
  const docNo = readFirst(item, ['current_act_doc_no', 'CURRENT_ACT_DOC_NO'], null);
  if (docNo === null || docNo === undefined || docNo === '') return null;
  const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
  return {
    doc_no: docNo,
    doc_number: String(
      readFirst(item, ['current_act_doc_number', 'CURRENT_ACT_DOC_NUMBER'], docNo) || docNo,
    ).trim(),
    doc_date: readFirst(item, ['current_act_doc_date', 'CURRENT_ACT_DOC_DATE'], null),
    item_id: readFirst(item, ['ID', 'id', 'ITEM_ID', 'item_id'], null),
    inv_no: invNo,
    hub_db_id: readFirst(item, ['hub_db_id', 'HUB_DB_ID'], ''),
  };
};

export default function EquipmentCurrentActIndicator({
  item,
  onOpenAct = null,
  openingDocNo = '',
}) {
  const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim() || 'без номера';
  const availableValue = readFirst(
    item,
    ['current_act_available', 'CURRENT_ACT_AVAILABLE'],
    undefined,
  );
  const currentAct = buildCurrentEquipmentAct(item);
  const available = isTrue(availableValue) && Boolean(currentAct);
  const unavailable = isFalse(availableValue);

  if (available) {
    const actDate = formatActDate(currentAct.doc_date);
    const label = `Открыть актуальный акт ${currentAct.doc_number}${actDate ? ` от ${actDate}` : ''}`;
    const opening = String(openingDocNo || '') === String(currentAct.doc_no);
    if (typeof onOpenAct === 'function') {
      return (
        <Tooltip title={label} arrow>
          <span>
            <IconButton
              size="small"
              color="success"
              aria-label={label}
              disabled={opening}
              onClick={(event) => {
                event.stopPropagation();
                void onOpenAct(currentAct);
              }}
              sx={{ width: 32, height: 32 }}
            >
              {opening ? <CircularProgress size={18} color="inherit" /> : <CheckCircleOutlineIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={`Актуальный акт ${currentAct.doc_number}${actDate ? ` от ${actDate}` : ''}`} arrow>
        <CheckCircleOutlineIcon
          color="success"
          fontSize="small"
          role="img"
          aria-label={`Актуальный акт есть для оборудования ${invNo}`}
        />
      </Tooltip>
    );
  }

  const label = unavailable
    ? `Актуального акта нет для оборудования ${invNo}`
    : `Статус актуального акта недоступен для оборудования ${invNo}`;
  return (
    <Tooltip title={label} arrow>
      <Typography
        component="span"
        role="img"
        aria-label={label}
        color="text.disabled"
        sx={{ display: 'inline-block', minWidth: 24, textAlign: 'center', fontWeight: 700 }}
      >
        {unavailable ? '—' : '?'}
      </Typography>
    </Tooltip>
  );
}
