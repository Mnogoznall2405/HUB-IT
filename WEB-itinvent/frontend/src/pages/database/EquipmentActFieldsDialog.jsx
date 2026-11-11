import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from '@mui/material';

import { readFirst } from './databaseRecordModel';

const renderField = (label, value) => (
  <>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2">{value}</Typography>
  </>
);

function EquipmentActFieldsDialog({
  open,
  onClose,
  isMobile = false,
  selectedAct,
  summary,
  openingDocNo = '',
  onOpenFile,
  formatDate = (value) => value,
}) {
  const selectedDocNo = String(readFirst(selectedAct, ['doc_no', 'DOC_NO'], ''));
  const isOpening = Boolean(selectedDocNo) && openingDocNo === selectedDocNo;
  const titleDocNo = selectedAct
    ? `№ ${readFirst(selectedAct, ['doc_number', 'DOC_NUMBER', 'doc_no', 'DOC_NO'], '-')}`
    : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>
        Поля документа {titleDocNo}
      </DialogTitle>
      <DialogContent dividers>
        {!summary ? (
          <Typography variant="body2" color="text.secondary">
            Документ не выбран.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 1.5,
              }}
            >
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Документ
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 0.5, columnGap: 1 }}>
                  {renderField('Номер', summary.docNumber)}
                  {renderField('DOC_NO', summary.docNo)}
                  {renderField('Дата', formatDate(summary.docDate))}
                  {renderField('Тип', summary.typeName)}
                </Box>
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Привязка
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 0.5, columnGap: 1 }}>
                  {renderField('Филиал', summary.branchName)}
                  {renderField('Локация', summary.locationName)}
                  {renderField('Сотрудник', summary.employeeName)}
                  {renderField('ITEM_ID', summary.itemId)}
                </Box>
              </Paper>
            </Box>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Служебное
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '130px 1fr' }, rowGap: 0.5, columnGap: 1 }}>
                {renderField('Создан', `${formatDate(summary.createDate)} / ${summary.createUser}`)}
                {renderField('Изменен', `${formatDate(summary.changeDate)} / ${summary.changeUser}`)}
              </Box>
            </Paper>
            {summary.addInfo && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Описание
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {summary.addInfo}
                </Typography>
              </Paper>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        {selectedAct && (
          <Button
            variant="outlined"
            onClick={() => onOpenFile(selectedAct)}
            disabled={isOpening}
          >
            {isOpening ? 'Открытие...' : 'Открыть файл'}
          </Button>
        )}
        <Button variant="contained" onClick={onClose}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default EquipmentActFieldsDialog;
