import BotSettingsWorkspace from './BotSettingsWorkspace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Collapse,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import {
  AI_AD_TOOL_OPTIONS,
  AI_AD_TOOL_IDS,
  AI_FILE_TOOL_OPTIONS,
  AI_FILE_TOOL_IDS,
  AI_ITINVENT_DEFAULT_TOOLS,
  AI_ITINVENT_MULTI_DB_TOOL_ID,
  AI_ITINVENT_TOOL_OPTIONS,
  AI_ITINVENT_TOOL_IDS,
  AI_MFU_TOOL_OPTIONS,
  AI_MFU_TOOL_IDS,
  AI_NETWORK_TOOL_OPTIONS,
  AI_NETWORK_TOOL_IDS,
  AI_OFFICE_ACTION_TOOL_OPTIONS,
  AI_OFFICE_TOOL_OPTIONS,
  AI_OFFICE_TOOL_IDS,
} from '../accountConstants';
import {
  createAiBotDraft,
  getAiBotAdTools,
  getAiBotEnabledTools,
  getAiBotFileTools,
  getAiBotItinventTools,
  getAiBotMfuTools,
  getAiBotNetworkTools,
  getAiBotOfficeTools,
  isAiBotLiveDataEnabled,
} from './aiBotModel';

export function AiBotsAdminSection({
  bots,
  loading,
  savingBotId,
  runsByBotId,
  onRefresh,
  onCreate,
  onSave,
  openrouterConfigured,
  dbOptions = [],
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [draftsById, setDraftsById] = useState({});
  const [newDraft, setNewDraft] = useState(() => createAiBotDraft({
    title: 'Новый AI бот',
    slug: 'new-ai-bot',
    description: '',
    system_prompt: '',
  }));

  const previousBots = useRef({});
  useEffect(() => {
    const next = Object.fromEntries((Array.isArray(bots) ? bots : []).map((item) => [item.id, createAiBotDraft(item)]));
    const previous = previousBots.current;
    setDraftsById((current) => Object.fromEntries(Object.entries(next).map(([id, incoming]) => [id,
      current[id] && previous[id] && JSON.stringify(current[id]) !== JSON.stringify(previous[id])
        && JSON.stringify(current[id]) !== JSON.stringify(incoming) ? current[id] : incoming,
    ])));
    previousBots.current = next;
  }, [bots]);

  const updateDraft = useCallback((botId, key, value) => {
    setDraftsById((current) => ({
      ...current,
      [botId]: {
        ...(current[botId] || createAiBotDraft()),
        [key]: value,
      },
    }));
  }, []);

  const renderBotFields = (draft, onChange, section = 'all', creating = false) => {
    const enabledTools = getAiBotEnabledTools(draft);
    const liveDataEnabled = isAiBotLiveDataEnabled(draft);
    const fileToolsEnabled = getAiBotFileTools(draft).length > 0;
    const officeToolsEnabled = getAiBotOfficeTools(draft).length > 0;
    const adToolsEnabled = getAiBotAdTools(draft).length > 0;
    const allowedDatabases = Array.isArray(draft?.allowed_databases) ? draft.allowed_databases : [];

    const setDatabaseMode = (mode) => {
      const nextMode = String(mode || 'single').trim() || 'single';
      onChange('multi_db_mode', nextMode);
      if (nextMode === 'admin_multi_db') {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, AI_ITINVENT_MULTI_DB_TOOL_ID])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== AI_ITINVENT_MULTI_DB_TOOL_ID));
      onChange('allowed_databases', []);
    };

    const toggleLiveData = (checked) => {
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, ...AI_ITINVENT_DEFAULT_TOOLS])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => !AI_ITINVENT_TOOL_IDS.has(item)));
      onChange('multi_db_mode', 'single');
      onChange('allowed_databases', []);
    };

    const toggleFileTools = (checked) => {
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, ...AI_FILE_TOOL_OPTIONS.map((item) => item.id)])));
        onChange('allow_generated_artifacts', true);
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => !AI_FILE_TOOL_IDS.has(item)));
    };

    const toggleTool = (toolId, checked) => {
      const normalizedToolId = String(toolId || '').trim();
      if (!normalizedToolId) return;
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, normalizedToolId])));
        if (normalizedToolId === AI_ITINVENT_MULTI_DB_TOOL_ID) {
          onChange('multi_db_mode', 'admin_multi_db');
        }
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== normalizedToolId));
      if (normalizedToolId === AI_ITINVENT_MULTI_DB_TOOL_ID) {
        onChange('multi_db_mode', 'single');
        onChange('allowed_databases', []);
      }
    };

    const toggleFileTool = (toolId, checked) => {
      const normalizedToolId = String(toolId || '').trim();
      if (!normalizedToolId) return;
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, normalizedToolId])));
        onChange('allow_generated_artifacts', true);
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== normalizedToolId));
    };

    const toggleOfficeTools = (checked) => {
      const officeIds = [...AI_OFFICE_TOOL_OPTIONS, ...AI_OFFICE_ACTION_TOOL_OPTIONS].map((item) => item.id);
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, ...officeIds])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => !AI_OFFICE_TOOL_IDS.has(item)));
    };

    const toggleOfficeTool = (toolId, checked) => {
      const normalizedToolId = String(toolId || '').trim();
      if (!normalizedToolId) return;
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, normalizedToolId])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== normalizedToolId));
    };

    const toggleAdTools = (checked) => {
      const adIds = AI_AD_TOOL_OPTIONS.map((item) => item.id);
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, ...adIds])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => !AI_AD_TOOL_IDS.has(item)));
    };

    const toggleAdTool = (toolId, checked) => {
      const normalizedToolId = String(toolId || '').trim();
      if (!normalizedToolId) return;
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, normalizedToolId])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== normalizedToolId));
    };

    const mfuToolsEnabled = getAiBotMfuTools(draft).length > 0;
    const networkToolsEnabled = getAiBotNetworkTools(draft).length > 0;

    const toggleMfuTools = (checked) => {
      const mfuIds = AI_MFU_TOOL_OPTIONS.map((item) => item.id);
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, ...mfuIds])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => !AI_MFU_TOOL_IDS.has(item)));
    };

    const toggleMfuTool = (toolId, checked) => {
      const normalizedToolId = String(toolId || '').trim();
      if (!normalizedToolId) return;
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, normalizedToolId])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== normalizedToolId));
    };

    const toggleNetworkTools = (checked) => {
      const networkIds = AI_NETWORK_TOOL_OPTIONS.map((item) => item.id);
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, ...networkIds])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => !AI_NETWORK_TOOL_IDS.has(item)));
    };

    const toggleNetworkTool = (toolId, checked) => {
      const normalizedToolId = String(toolId || '').trim();
      if (!normalizedToolId) return;
      if (checked) {
        onChange('enabled_tools', Array.from(new Set([...enabledTools, normalizedToolId])));
        return;
      }
      onChange('enabled_tools', enabledTools.filter((item) => item !== normalizedToolId));
    };

    return (
      <Grid container spacing={1.2}>
        {(section === 'all' || section === 'settings') && <>
        <Grid item xs={12} md={6}>
          <TextField label="Название" fullWidth size="small" value={draft.title} onChange={(event) => onChange('title', event.target.value)} />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField disabled={!creating} label="Slug" fullWidth size="small" value={draft.slug} onChange={(event) => onChange('slug', event.target.value.toLowerCase())} />
        </Grid>
        <Grid item xs={12}>
          <TextField label="Описание" fullWidth size="small" value={draft.description} onChange={(event) => onChange('description', event.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <TextField label="Инструкция агенту" fullWidth multiline minRows={4} value={draft.system_prompt} onChange={(event) => onChange('system_prompt', event.target.value)} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField label="Модель" fullWidth size="small" value={draft.model} onChange={(event) => onChange('model', event.target.value)} placeholder="openai/gpt-4o-mini" />
        </Grid>
        <Grid item xs={6} md={2}>
          <TextField label="Вариативность ответа" type="number" fullWidth size="small" value={draft.temperature} onChange={(event) => onChange('temperature', Number(event.target.value || 0))} />
        </Grid>
        <Grid item xs={6} md={2}>
          <TextField label="Лимит токенов ответа" type="number" fullWidth size="small" value={draft.max_tokens} onChange={(event) => onChange('max_tokens', Number(event.target.value || 0))} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField label="KB scope (через запятую)" fullWidth size="small" value={draft.allowed_kb_scope} onChange={(event) => onChange('allowed_kb_scope', event.target.value)} />
        </Grid>
        </>}
        {(section === 'all' || section === 'tools') && <>
        <Grid item xs={12}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            <FormControlLabel control={<Switch checked={draft.allow_file_input} onChange={(event) => onChange('allow_file_input', event.target.checked)} />} label="Принимать файлы" />
            <FormControlLabel control={<Switch checked={draft.allow_generated_artifacts} onChange={(event) => onChange('allow_generated_artifacts', event.target.checked)} />} label="Генерировать файлы" />
            <FormControlLabel control={<Switch checked={draft.allow_kb_document_delivery} onChange={(event) => onChange('allow_kb_document_delivery', event.target.checked)} />} label="Отправлять KB-шаблоны" />
            <FormControlLabel control={<Switch checked={draft.is_enabled} onChange={(event) => onChange('is_enabled', event.target.checked)} />} label="Включён" />
          </Stack>
        </Grid>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Данные ITinvent</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Инструменты чтения данных ITinvent и действия через карточки подтверждения.
                  </Typography>
                </Box>
                <FormControlLabel
                  control={<Switch checked={liveDataEnabled} onChange={(event) => toggleLiveData(event.target.checked)} />}
                  label="Инструменты ITinvent"
                />
              </Stack>



              <Collapse in={liveDataEnabled} unmountOnExit>
                <Stack spacing={1.1}>
                  <Grid container spacing={0.5}>
                    {AI_ITINVENT_TOOL_OPTIONS.map((tool) => (
                      <Grid item xs={12} md={6} key={tool.id}>
                        <FormControlLabel
                          control={(
                            <Checkbox
                              size="small"
                              checked={enabledTools.includes(tool.id)}
                              onChange={(event) => toggleTool(tool.id, event.target.checked)}
                            />
                          )}
                          label={tool.label}
                        />
                      </Grid>
                    ))}
                  </Grid>

                  <Grid container spacing={1.1}>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth size="small">
                        <InputLabel id={`ai-bot-mode-${draft.slug || 'new'}`}>Режим базы данных</InputLabel>
                        <Select
                          labelId={`ai-bot-mode-${draft.slug || 'new'}`}
                          label="Режим базы данных"
                          value={draft.multi_db_mode || 'single'}
                          onChange={(event) => setDatabaseMode(event.target.value)}
                        >
                          <MenuItem value="single">Одна база</MenuItem>
                          <MenuItem value="admin_multi_db">Админ: несколько баз</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={8}>
                      <FormControl fullWidth size="small" disabled={draft.multi_db_mode !== 'admin_multi_db'}>
                        <InputLabel id={`ai-bot-allowed-dbs-${draft.slug || 'new'}`}>Allowed databases</InputLabel>
                        <Select
                          multiple
                          labelId={`ai-bot-allowed-dbs-${draft.slug || 'new'}`}
                          label="Allowed databases"
                          value={allowedDatabases}
                          onChange={(event) => {
                            const rawValue = event.target.value;
                            const nextValue = Array.isArray(rawValue)
                              ? rawValue
                              : String(rawValue || '').split(',').map((item) => item.trim()).filter(Boolean);
                            onChange('allowed_databases', nextValue);
                          }}
                          renderValue={(selected) => (Array.isArray(selected) ? selected.join(', ') : '')}
                        >
                          {(Array.isArray(dbOptions) ? dbOptions : []).map((item) => (
                            <MenuItem key={item.id} value={item.id}>
                              <Checkbox size="small" checked={allowedDatabases.includes(item.id)} />
                              <Typography variant="body2">{item.name || item.id}</Typography>
                            </MenuItem>
                          ))}
                        </Select>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                          Пустой список означает, что админу доступны все настроенные базы.
                        </Typography>
                      </FormControl>
                    </Grid>
                  </Grid>
                </Stack>
              </Collapse>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Active Directory</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Инструменты чтения AD для AI-чата: срок смены пароля, дата последнего pwdLastSet и остаток дней по политике.
                  </Typography>
                </Box>
                <FormControlLabel
                  control={<Switch checked={adToolsEnabled} onChange={(event) => toggleAdTools(event.target.checked)} />}
                  label="AD инструменты"
                />
              </Stack>
              <Collapse in={adToolsEnabled} unmountOnExit>
                <Grid container spacing={0.5}>
                  {AI_AD_TOOL_OPTIONS.map((tool) => (
                    <Grid item xs={12} md={6} key={tool.id}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            size="small"
                            checked={enabledTools.includes(tool.id)}
                            onChange={(event) => toggleAdTool(tool.id, event.target.checked)}
                          />
                        )}
                        label={tool.label}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Collapse>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Создание файлов</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Создание файлов и отчётов как обычных вложений в чат. Работает только при включённом параметре «Генерировать файлы».
                  </Typography>
                </Box>
                <FormControlLabel
                  control={<Switch checked={fileToolsEnabled} onChange={(event) => toggleFileTools(event.target.checked)} />}
                  label="Инструменты файлов"
                />
              </Stack>

              <Collapse in={fileToolsEnabled} unmountOnExit>
                <Grid container spacing={0.5}>
                  {AI_FILE_TOOL_OPTIONS.map((tool) => (
                    <Grid item xs={12} md={6} key={tool.id}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            size="small"
                            checked={enabledTools.includes(tool.id)}
                            onChange={(event) => toggleFileTool(tool.id, event.target.checked)}
                          />
                        )}
                        label={tool.label}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Collapse>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Офисные инструменты</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Инструменты для почты и задач. Действия на изменение готовятся как карточки подтверждения.
                  </Typography>
                </Box>
                <FormControlLabel
                  control={<Switch checked={officeToolsEnabled} onChange={(event) => toggleOfficeTools(event.target.checked)} />}
                  label="Офисные инструменты"
                />
              </Stack>

              <Collapse in={officeToolsEnabled} unmountOnExit>
                <Stack spacing={1.1}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                      Только чтение
                    </Typography>
                    <Grid container spacing={0.5}>
                      {AI_OFFICE_TOOL_OPTIONS.map((tool) => (
                        <Grid item xs={12} md={6} key={tool.id}>
                          <FormControlLabel
                            control={(
                              <Checkbox
                                size="small"
                                checked={enabledTools.includes(tool.id)}
                                onChange={(event) => toggleOfficeTool(tool.id, event.target.checked)}
                              />
                            )}
                            label={tool.label}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                      Действия с подтверждением
                    </Typography>
                    <Grid container spacing={0.5}>
                      {AI_OFFICE_ACTION_TOOL_OPTIONS.map((tool) => (
                        <Grid item xs={12} md={6} key={tool.id}>
                          <FormControlLabel
                            control={(
                              <Checkbox
                                size="small"
                                checked={enabledTools.includes(tool.id)}
                                onChange={(event) => toggleOfficeTool(tool.id, event.target.checked)}
                              />
                            )}
                            label={tool.label}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                </Stack>
              </Collapse>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>МФУ и принтеры</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Инструменты мониторинга МФУ/принтеров: список устройств, SNMP/ping статус, счётчик страниц.
                  </Typography>
                </Box>
                <FormControlLabel
                  control={<Switch checked={mfuToolsEnabled} onChange={(event) => toggleMfuTools(event.target.checked)} />}
                  label="МФУ инструменты"
                />
              </Stack>
              <Collapse in={mfuToolsEnabled} unmountOnExit>
                <Grid container spacing={0.5}>
                  {AI_MFU_TOOL_OPTIONS.map((tool) => (
                    <Grid item xs={12} md={6} key={tool.id}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            size="small"
                            checked={enabledTools.includes(tool.id)}
                            onChange={(event) => toggleMfuTool(tool.id, event.target.checked)}
                          />
                        )}
                        label={tool.label}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Collapse>
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Сетевая инфраструктура</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Инструменты для работы с патч-панелями, розетками и портами коммутаторов.
                  </Typography>
                </Box>
                <FormControlLabel
                  control={<Switch checked={networkToolsEnabled} onChange={(event) => toggleNetworkTools(event.target.checked)} />}
                  label="Сетевые инструменты"
                />
              </Stack>
              <Collapse in={networkToolsEnabled} unmountOnExit>
                <Grid container spacing={0.5}>
                  {AI_NETWORK_TOOL_OPTIONS.map((tool) => (
                    <Grid item xs={12} md={6} key={tool.id}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            size="small"
                            checked={enabledTools.includes(tool.id)}
                            onChange={(event) => toggleNetworkTool(tool.id, event.target.checked)}
                          />
                        )}
                        label={tool.label}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Collapse>
            </Stack>
          </Paper>
        </Grid>
        </>}
        {(section === 'all' || section === 'settings') && <>
        <Grid item xs={12}>
          <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
            <Stack spacing={1.1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Лимиты инструментов</Typography>
                <Typography variant="caption" color="text.secondary">
                  Максимальное количество раундов и вызовов инструментов за один ответ бота.
                </Typography>
              </Box>
              <Grid container spacing={4} sx={{ px: 1.5 }}>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    Раундов инструментов: <strong>{draft.max_tool_rounds}</strong>
                  </Typography>
                  <Slider
                    value={draft.max_tool_rounds}
                    onChange={(event, value) => onChange('max_tool_rounds', value)}
                    min={1}
                    max={12}
                    step={1}
                    marks={[{ value: 1, label: '1' }, { value: 6, label: '6' }, { value: 12, label: '12' }]}
                    valueLabelDisplay="auto"
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    Вызовов за раунд: <strong>{draft.max_tool_calls_per_round}</strong>
                  </Typography>
                  <Slider
                    value={draft.max_tool_calls_per_round}
                    onChange={(event, value) => onChange('max_tool_calls_per_round', value)}
                    min={1}
                    max={5}
                    step={1}
                    marks={[{ value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }]}
                    valueLabelDisplay="auto"
                    size="small"
                  />
                </Grid>
              </Grid>
              {draft.max_tool_rounds > 8 ? (
                <Alert severity="warning" sx={{ mt: 0.5 }}>
                  Значение больше 8 раундов может значительно увеличить время ответа и потребление токенов.
                </Alert>
              ) : null}
            </Stack>
          </Paper>
        </Grid>
        </>}
      </Grid>
    );
  };

  return <BotSettingsWorkspace
    bots={bots} loading={loading} savingBotId={savingBotId} runsByBotId={runsByBotId}
    onRefresh={onRefresh} onCreate={onCreate} onSave={onSave} openrouterConfigured={openrouterConfigured}
    draftsById={draftsById} newDraft={newDraft} setNewDraft={setNewDraft}
    updateDraft={updateDraft} renderFields={renderBotFields} ui={ui}
  />;
}
