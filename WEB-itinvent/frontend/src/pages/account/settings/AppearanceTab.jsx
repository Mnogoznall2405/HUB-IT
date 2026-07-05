import {
  Box,
  Button,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Typography,
} from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SectionCard from '../shared/SectionCard';
import { MobileBottomNavSettingsCard } from './MobileBottomNavSettingsCard';

export default function AppearanceTab({
  themeMode,
  setThemeMode,
  fontFamily,
  setFontFamily,
  fontScale,
  setFontScale,
  availableNavigationItems,
  mobileBottomNavItems,
  resolvedMobileNavigationItems,
  setMobileBottomNavItems,
  handleSavePreferences,
  saving,
}) {

  return (
    <Grid container spacing={1.25} sx={{ minHeight: 0 }}>
      <Grid item xs={12}>
        <SectionCard
          title="Внешний вид"
          description="Тема, шрифт и масштаб интерфейса."
          contentSx={{ p: 1.5 }}
        >
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Тема</InputLabel>
                <Select value={themeMode} label="Тема" onChange={(event) => setThemeMode(event.target.value)}>
                  <MenuItem value="light">Светлая</MenuItem>
                  <MenuItem value="dark">Тёмная</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <FormControl fullWidth size="small">
                <InputLabel>Шрифт</InputLabel>
                <Select value={fontFamily} label="Шрифт" onChange={(event) => setFontFamily(event.target.value)}>
                  <MenuItem value="Aptos">Aptos</MenuItem>
                  <MenuItem value="Segoe UI">Segoe UI</MenuItem>
                  <MenuItem value="Inter">Inter</MenuItem>
                  <MenuItem value="Roboto">Roboto</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
                Масштаб шрифта: {fontScale.toFixed(2)}
              </Typography>
              <Slider min={0.9} max={1.2} step={0.05} value={fontScale} onChange={(_, value) => setFontScale(Array.isArray(value) ? value[0] : value)} />
            </Grid>
          </Grid>
          <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
              Сохранение сразу обновляет интерфейс.
            </Typography>
            <Button variant="contained" startIcon={<SaveOutlinedIcon />} onClick={handleSavePreferences} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </Box>
        </SectionCard>
      </Grid>
      <Grid item xs={12}>
        <MobileBottomNavSettingsCard
          availableItems={availableNavigationItems}
          selectedPaths={mobileBottomNavItems}
          resolvedItems={resolvedMobileNavigationItems}
          onChange={setMobileBottomNavItems}
        />
      </Grid>
    </Grid>
  );
}
