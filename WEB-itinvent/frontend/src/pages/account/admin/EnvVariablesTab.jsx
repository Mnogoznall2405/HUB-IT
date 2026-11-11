import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import { ENV_HELP_WIDE_QUERY, staticRunbook } from '../accountConstants';
import { formatDateTime } from '../accountUserModel';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import SectionCard from '../shared/SectionCard';

export default function EnvVariablesTab({ envState, loading, saving, onRefresh, onSave }) {

  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isHelpWide = useMediaQuery(ENV_HELP_WIDE_QUERY);
  const [search, setSearch] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [draftValues, setDraftValues] = useState({});
  const [activatedFields, setActivatedFields] = useState({});
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const next = {};
    (envState?.items || []).forEach((item) => {
      next[item.key] = item.value ?? '';
    });
    setDraftValues(next);
    setActivatedFields({});
  }, [envState?.items]);

  const filteredItems = useMemo(() => {
    const needle = String(search || '').trim().toLowerCase();
    const items = Array.isArray(envState?.items) ? envState.items : [];
    if (!needle) return items;
    return items.filter((item) => (
      String(item.key || '').toLowerCase().includes(needle)
      || String(item.description || '').toLowerCase().includes(needle)
      || String(item.category || '').toLowerCase().includes(needle)
    ));
  }, [envState?.items, search]);

  const groupedItems = useMemo(() => {
    const groups = new Map();
    filteredItems.forEach((item) => {
      const category = item.category || 'Прочее';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });
    return Array.from(groups.entries());
  }, [filteredItems]);

  const dirtyCount = useMemo(() => {
    const original = new Map((envState?.items || []).map((item) => [item.key, item.value ?? '']));
    return Object.keys(draftValues).filter((key) => (draftValues[key] ?? '') !== (original.get(key) ?? '')).length;
  }, [draftValues, envState?.items]);

  const renderValueField = (item) => {
    const inputType = item.is_sensitive && !showSecrets ? 'password' : 'text';
    const fieldName = `env_${item.key.toLowerCase()}_${String(item.category || 'misc').toLowerCase().replace(/\s+/g, '_')}`;
    return (
      <TextField
        fullWidth
        size="small"
        type={inputType}
        label="Значение"
        value={draftValues[item.key] ?? ''}
        onFocus={() => setActivatedFields((prev) => ({ ...prev, [item.key]: true }))}
        onChange={(event) => setDraftValues((prev) => ({ ...prev, [item.key]: event.target.value }))}
        autoComplete="new-password"
        name={fieldName}
        inputProps={{
          autoComplete: 'new-password',
          spellCheck: 'false',
          readOnly: !activatedFields[item.key],
        }}
      />
    );
  };

  const renderHelpPanel = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25 }}>
        <Stack spacing={1}>
          <Accordion defaultExpanded disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Что нужно применить</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {(envState?.apply_plan || []).length > 0 ? envState.apply_plan.map((item) => (
                  <Paper key={item.target} variant="outlined" sx={{ p: 1.1, borderRadius: '12px' }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>{item.label}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.35 }}>
                      {item.apply_hint}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.55, color: 'text.secondary', overflowWrap: 'anywhere' }}>
                      {item.keys.join(', ')}
                    </Typography>
                  </Paper>
                )) : (
                  <Typography variant="body2" color="text.secondary">
                    После сохранения здесь появится список действий для backend, scan, бота и frontend.
                  </Typography>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Последние изменения</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {(envState?.recent_changes || []).length > 0 ? envState.recent_changes.map((item, index) => (
                  <Paper key={`${item.key}-${item.changed_at}-${index}`} variant="outlined" sx={{ p: 1.1, borderRadius: '12px' }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>{item.key}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.35 }}>
                      {item.actor_username || 'system'} • {formatDateTime(item.changed_at)}
                    </Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.55, lineHeight: 1.35 }}>
                      {item.old_value_masked} → {item.new_value_masked}
                    </Typography>
                  </Paper>
                )) : (
                  <Typography variant="body2" color="text.secondary">Изменений пока нет.</Typography>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Команды PM2</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {staticRunbook.pm2.map((command) => (
                  <Paper
                    key={command}
                    variant="outlined"
                    sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
                  >
                    <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {command}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Frontend и VITE_*</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.2 }}>
              <Stack spacing={1}>
                {staticRunbook.frontend.map((command) => (
                  <Paper
                    key={command}
                    variant="outlined"
                    sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
                  >
                    <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {command}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </Stack>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, height: '100%' }}>
      <SectionCard sx={{ flexShrink: 0 }} contentSx={{ p: 1.1 }}>
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', xl: 'row' }} spacing={1} alignItems={{ xs: 'stretch', xl: 'center' }}>
            <TextField
              fullWidth
              size="small"
              type="search"
              label="Поиск переменной"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              name="env-search-field"
              inputProps={{ autoComplete: 'off', spellCheck: 'false' }}
              InputProps={{ startAdornment: <SearchOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
              sx={{ flex: 1, minWidth: 0 }}
            />
            <FormControlLabel
              control={<Switch checked={showSecrets} onChange={(event) => setShowSecrets(event.target.checked)} />}
              label="Секреты"
              sx={{ m: 0, flexShrink: 0 }}
            />
            <Button
              variant={helpOpen ? 'contained' : 'outlined'}
              onClick={() => setHelpOpen((prev) => !prev)}
              endIcon={(
                <ExpandMoreOutlinedIcon
                  sx={{
                    transition: 'transform 0.2s ease',
                    transform: helpOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              )}
            >
              Помощь и применение
            </Button>
            <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} onClick={onRefresh} disabled={loading || saving}>Обновить</Button>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
              onClick={() => onSave(draftValues)}
              disabled={saving || dirtyCount === 0}
            >
              {saving ? 'Сохранение...' : `Сохранить${dirtyCount ? ` (${dirtyCount})` : ''}`}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            Редактор .env доступен только администратору. Пустое значение сохранится как KEY=. {dirtyCount > 0 ? `Изменено полей: ${dirtyCount}.` : 'Изменений пока нет.'}
          </Typography>
        </Stack>
      </SectionCard>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: isHelpWide && helpOpen ? 'minmax(0, 1fr) 300px' : 'minmax(0, 1fr)',
          gap: 1.25,
          minHeight: 0,
          flex: 1,
        }}
      >
        <SectionCard title="Редактор .env" action={<Chip size="small" label={`${filteredItems.length} перем.`} />} sx={{ minHeight: 0 }} contentSx={{ p: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25 }}>
              {loading ? (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <CircularProgress size={26} />
                </Box>
              ) : groupedItems.length > 0 ? groupedItems.map(([category, items]) => (
                <Accordion
                  key={category}
                  defaultExpanded
                  disableGutters
                  sx={{
                    mb: 1,
                    bgcolor: 'transparent',
                    border: '1px solid',
                    borderColor: theme.customAdmin?.border || 'divider',
                    borderRadius: '12px !important',
                    overflow: 'hidden',
                    '&:before': { display: 'none' },
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>{category}</Typography>
                      <Chip size="small" label={items.length} />
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0.85 }}>
                    <Stack spacing={0.85}>
                      {items.map((item) => (
                        <Paper key={item.key} variant="outlined" sx={{ p: 0.9, borderRadius: '10px', borderColor: theme.customAdmin?.border || 'divider' }}>
                          <Stack spacing={0.7}>
                            <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={0.75}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{item.key}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2, lineHeight: 1.35 }}>
                                  {item.description}
                                </Typography>
                              </Box>
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {item.is_sensitive ? <Chip size="small" color="warning" label="Секрет" /> : <Chip size="small" variant="outlined" label="Обычная" />}
                                {item.apply_target_labels.map((label) => (
                                  <Chip key={`${item.key}-${label}`} size="small" variant="outlined" label={label} />
                                ))}
                              </Stack>
                            </Stack>
                            {renderValueField(item)}
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              )) : (
                <Typography variant="body2" color="text.secondary">По фильтру ничего не найдено.</Typography>
              )}
            </Box>
          </Box>
        </SectionCard>

        {isHelpWide && helpOpen ? (
          <SectionCard title="Помощь и применение" sx={{ minHeight: 0 }} contentSx={{ p: 0 }}>
            {renderHelpPanel()}
          </SectionCard>
        ) : null}
      </Box>

      {!isHelpWide && helpOpen ? (
        <SectionCard title="Помощь и применение" sx={{ flexShrink: 0 }} contentSx={{ p: 0 }}>
          {renderHelpPanel()}
        </SectionCard>
      ) : null}
    </Box>
  );
}
