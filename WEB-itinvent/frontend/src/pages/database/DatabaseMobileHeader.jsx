import { memo } from 'react';
import {
  Box,
  Chip,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Typography,
  alpha,
} from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';

import { normalizeDbId } from './databaseRecordModel';

const noop = () => {};

function DatabaseMobileHeader({
  theme,
  databases = [],
  dbName = '',
  currentDb = null,
  selectedDatabaseName = 'База',
  onOpenMainDrawer = noop,
  onDatabaseSelectChange = noop,
}) {
  if (databases.length === 0) {
    return (
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <IconButton
            onClick={onOpenMainDrawer}
            size="small"
            sx={{ color: theme.palette.text.primary, width: 36, height: 36, flexShrink: 0 }}
            aria-label="Открыть меню"
          >
            <MenuRoundedIcon />
          </IconButton>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: 1, flexShrink: 0 }}>
            ITINVENT
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <IconButton
          onClick={onOpenMainDrawer}
          size="small"
          sx={{ color: theme.palette.text.primary, width: 36, height: 36, flexShrink: 0 }}
          aria-label="Открыть меню"
        >
          <MenuRoundedIcon />
        </IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: 1, flexShrink: 0 }}>
          ITINVENT
        </Typography>

        <FormControl size="small" sx={{ flex: 1, minWidth: 0, maxWidth: 220, ml: 'auto' }}>
          <Select
            value={normalizeDbId(dbName || '')}
            onChange={onDatabaseSelectChange}
            displayEmpty
            renderValue={() => (
              <Typography
                component="span"
                noWrap
                sx={{ display: 'block', minWidth: 0, fontSize: '0.75rem', fontWeight: 700, lineHeight: 1.2 }}
              >
                {selectedDatabaseName}
              </Typography>
            )}
            MenuProps={{
              PaperProps: {
                sx: { maxHeight: 320 },
              },
            }}
            sx={{
              height: 32,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.10 : 0.05),
              '& .MuiSelect-select': {
                py: 0.5,
                pl: 1,
                pr: '28px !important',
                minHeight: '0 !important',
                display: 'flex',
                alignItems: 'center',
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.20 : 0.14),
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.35 : 0.28),
              },
              '& .MuiSelect-icon': {
                right: 4,
                color: theme.palette.text.secondary,
              },
            }}
          >
            {databases.map((db) => (
              <MenuItem key={normalizeDbId(db.id)} value={normalizeDbId(db.id)} dense>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
                  <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
                    {db.name}
                  </Typography>
                  {normalizeDbId(db.id) === normalizeDbId(currentDb?.id) && (
                    <Chip label="Текущая" size="small" color="success" sx={{ height: 18, fontSize: '0.65rem', flexShrink: 0 }} />
                  )}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    </Box>
  );
}

export default memo(DatabaseMobileHeader);
