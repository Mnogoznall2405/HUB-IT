import { ToggleButton, ToggleButtonGroup } from '@mui/material';

export default function MailSectionTabs({ value, onChange }) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_event, next) => {
        if (next) onChange(next);
      }}
      data-testid="mail-section-tabs"
      sx={{
        '& .MuiToggleButton-root': {
          px: 1.25,
          py: 0.35,
          fontWeight: 700,
          textTransform: 'none',
        },
      }}
    >
      <ToggleButton value="inbox">Почта</ToggleButton>
      <ToggleButton value="quotas" data-testid="mail-shell-quotas-tab">Квоты</ToggleButton>
    </ToggleButtonGroup>
  );
}
