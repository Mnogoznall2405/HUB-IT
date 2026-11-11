import { memo } from 'react';
import { Box, Typography } from '@mui/material';

import { getOfficeSubtlePanelSx } from '../../theme/officeUiTokens';

const defaultFormatDate = (value) => value || '-';

const ActionHistoryPanel = memo(function ActionHistoryPanel({
  ui,
  title,
  history,
  formatDate = defaultFormatDate,
  mt = 2,
  countLabel = 'Всего замен',
  multipleMessage = 'Для групповой операции история не отображается.',
  emptyMessage = 'История пуста',
  loadingMessage = 'Загрузка истории...',
}) {
  return (
    <Box
      sx={getOfficeSubtlePanelSx(ui, {
        mt,
        p: 2,
        borderRadius: 1,
        bgcolor: ui.actionBg,
      })}
    >
      <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {history ? (
        history.multiple ? (
          <Typography variant="body2" color="text.secondary">
            {multipleMessage}
          </Typography>
        ) : history.last_date ? (
          <>
            <Typography variant="body2" color="text.secondary">
              Последняя: {formatDate(history.last_date)}
            </Typography>
            {history.time_ago_str && (
              <Typography variant="body2" color="text.secondary">
                Прошло: {history.time_ago_str}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {countLabel}: {history.count}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {emptyMessage}
          </Typography>
        )
      ) : (
        <Typography variant="body2" color="text.secondary">
          {loadingMessage}
        </Typography>
      )}
    </Box>
  );
});

export default ActionHistoryPanel;
