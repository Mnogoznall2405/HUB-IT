import { Box, Checkbox, Chip, Avatar } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { alpha } from '@mui/material/styles';
import { getInitials } from '../../../pages/tasks/taskFormatters';
import { getTaskUserLabel } from '../../../pages/tasks/taskUserUtils';
import TaskUserPickerRow from './TaskUserPickerRow';

export const createTaskUserAutocompleteOptionRenderer = ({ ui, theme, multiple = false }) => (props, option, { selected }) => {
  const { key, ...optionProps } = props;
  const trailing = multiple ? (
    <Checkbox checked={selected} tabIndex={-1} size="small" sx={{ p: 0.15, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: 20 } }} />
  ) : selected ? (
    <CheckIcon sx={{ fontSize: 18, color: theme.palette.primary.main, flexShrink: 0 }} />
  ) : (
    <Box sx={{ width: 18, flexShrink: 0 }} />
  );

  return (
    <Box
      component="li"
      key={key}
      {...optionProps}
      sx={{
        ...(selected ? { bgcolor: `${alpha(theme.palette.primary.main, 0.08)} !important` } : {}),
      }}
    >
      <TaskUserPickerRow userItem={option} selected={selected} ui={ui} theme={theme} trailing={trailing} />
    </Box>
  );
};

export const createTaskUserAutocompleteTagsRenderer = ({ theme }) => (value, getTagProps) => (
  value.map((option, index) => {
    const { key, ...tagProps } = getTagProps({ index });
    const label = getTaskUserLabel(option);
    return (
      <Chip
        key={key}
        {...tagProps}
        avatar={(
          <Avatar
            sx={{
              width: 22,
              height: 22,
              fontSize: '0.62rem',
              fontWeight: 900,
              bgcolor: alpha(theme.palette.primary.main, 0.18),
              color: theme.palette.primary.main,
            }}
          >
            {getInitials(label)}
          </Avatar>
        )}
        label={label}
        size="small"
        sx={{ borderRadius: '999px', fontWeight: 800, '& .MuiChip-avatar': { ml: 0.35 } }}
      />
    );
  })
);

export const createTaskObserverAutocompleteTagsRenderer = ({ theme }) => (value, getTagProps) => (
  value.map((option, index) => {
    const { key, ...tagProps } = getTagProps({ index });
    const label = getTaskUserLabel(option);
    return (
      <Chip
        key={key}
        {...tagProps}
        icon={<VisibilityOutlinedIcon sx={{ fontSize: '0.95rem !important' }} />}
        avatar={(
          <Avatar
            sx={{
              width: 22,
              height: 22,
              fontSize: '0.62rem',
              fontWeight: 900,
              bgcolor: alpha(theme.palette.secondary.main, 0.18),
              color: theme.palette.secondary.main,
            }}
          >
            {getInitials(label)}
          </Avatar>
        )}
        label={label}
        size="small"
        color="secondary"
        variant="outlined"
        sx={{ borderRadius: '999px', fontWeight: 800, '& .MuiChip-avatar': { ml: 0.35 } }}
      />
    );
  })
);
