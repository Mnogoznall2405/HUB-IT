import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

export default function PasswordSectionTabs({ value, onChange }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_event, next) => {
        if (next) onChange(next);
      }}
      data-testid="password-section-tabs"
      sx={{
        width: isMobile ? '100%' : 'auto',
        '& .MuiToggleButton-root': {
          px: 1.25,
          py: 0.35,
          fontWeight: 700,
          textTransform: 'none',
          flex: isMobile ? 1 : 'initial',
          fontSize: isMobile ? '0.75rem' : '0.875rem',
        },
      }}
    >
      <ToggleButton value="vault" data-testid="password-section-vault-tab">Хранилище</ToggleButton>
      <ToggleButton value="ad-expiry" data-testid="password-section-ad-expiry-tab">
        {isMobile ? 'AD пароли' : 'Истечение пароля AD'}
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
