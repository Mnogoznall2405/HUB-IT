import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteIcon from '@mui/icons-material/Delete';
import { buildMailUiTokens, getMailUiFontScopeSx } from './mailUiTokens';

export default function MailTemplatesDialog({
  open,
  onClose,
  templates,
  startCreateTemplate,
  templateEditId,
  startEditTemplate,
  templateCode,
  setTemplateCode,
  templateTitle,
  setTemplateTitle,
  templateCategory,
  setTemplateCategory,
  templateSubject,
  setTemplateSubject,
  templateBody,
  setTemplateBody,
  addTemplateField,
  templateFields,
  moveTemplateField,
  removeTemplateField,
  updateTemplateField,
  normalizeFieldKey,
  normalizeFieldOptions,
  fieldTypes,
  templateVariableHints,
  templateEditorPreview,
  saveTemplate,
  templateSaving,
  deleteTemplate,
  templateDeleting,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const canDelete = Boolean(templateEditId);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { ...getMailUiFontScopeSx(), borderRadius: '14px' } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Шаблоны IT-заявок</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          <Grid item xs={12} md={3.5}>
            <Paper variant="outlined" sx={{ borderRadius: '12px', maxHeight: 560, overflowY: 'auto' }}>
              <List dense>
                <ListItemButton onClick={startCreateTemplate} selected={!templateEditId}>
                  <ListItemText primary="+ Новый шаблон" primaryTypographyProps={{ fontWeight: 700 }} />
                </ListItemButton>
                {(templates || []).map((item) => (
                  <ListItemButton
                    key={item.id}
                    selected={String(templateEditId) === String(item.id)}
                    onClick={() => startEditTemplate(item)}
                  >
                    <ListItemText
                      primary={item.title || item.code || 'Без названия'}
                      secondary={item.code || ''}
                      primaryTypographyProps={{ noWrap: true }}
                      secondaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
          </Grid>

          <Grid item xs={12} md={8.5}>
            <Stack spacing={1.1}>
              <Grid container spacing={1}>
                <Grid item xs={12} md={4}>
                  <TextField
                    size="small"
                    label="Код"
                    value={templateCode}
                    onChange={(event) => setTemplateCode(event.target.value)}
                    InputProps={{ sx: { borderRadius: '10px' } }}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} md={5}>
                  <TextField
                    size="small"
                    label="Название"
                    value={templateTitle}
                    onChange={(event) => setTemplateTitle(event.target.value)}
                    InputProps={{ sx: { borderRadius: '10px' } }}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField
                    size="small"
                    label="Категория"
                    value={templateCategory}
                    onChange={(event) => setTemplateCategory(event.target.value)}
                    InputProps={{ sx: { borderRadius: '10px' } }}
                    fullWidth
                  />
                </Grid>
              </Grid>

              <TextField
                size="small"
                label="Шаблон темы"
                value={templateSubject}
                onChange={(event) => setTemplateSubject(event.target.value)}
                InputProps={{ sx: { borderRadius: '10px' } }}
                fullWidth
              />

              <TextField
                label="Текст шаблона"
                value={templateBody}
                onChange={(event) => setTemplateBody(event.target.value)}
                minRows={6}
                multiline
                InputProps={{ sx: { borderRadius: '10px' } }}
                fullWidth
              />

              <Paper variant="outlined" sx={{ p: 1.1, borderRadius: '12px' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Поля формы</Typography>
                  <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addTemplateField} sx={{ textTransform: 'none' }}>
                    Добавить поле
                  </Button>
                </Stack>

                <Stack spacing={0.9}>
                  {(templateFields || []).map((field, index, arr) => {
                    const fieldType = String(field?.type || 'text');
                    const supportsOptions = fieldType === 'select' || fieldType === 'multiselect';
                    const optionsText = normalizeFieldOptions(field?.options).join('\n');
                    return (
                      <Paper key={`${field?.key || 'field'}_${index}`} variant="outlined" sx={{ p: 1, borderRadius: '10px' }}>
                        <Stack spacing={0.85}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center">
                            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                              {`Поле #${index + 1}`}
                            </Typography>
                            <Stack direction="row" spacing={0.2}>
                              <Tooltip title="Вверх">
                                <span>
                                  <IconButton size="small" disabled={index === 0} onClick={() => moveTemplateField(index, -1)}>
                                    <ArrowUpwardIcon fontSize="inherit" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title="Вниз">
                                <span>
                                  <IconButton size="small" disabled={index === arr.length - 1} onClick={() => moveTemplateField(index, 1)}>
                                    <ArrowDownwardIcon fontSize="inherit" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title="Удалить поле">
                                <IconButton size="small" color="error" onClick={() => removeTemplateField(index)}>
                                  <DeleteIcon fontSize="inherit" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </Stack>

                          <Grid container spacing={0.9}>
                            <Grid item xs={12} md={5}>
                              <TextField
                                size="small"
                                label="Ключ"
                                value={field?.key || ''}
                                onChange={(event) => updateTemplateField(index, { key: normalizeFieldKey(event.target.value, field?.key) })}
                                InputProps={{ sx: { borderRadius: '8px' } }}
                                fullWidth
                              />
                            </Grid>
                            <Grid item xs={12} md={7}>
                              <TextField
                                size="small"
                                label="Название поля"
                                value={field?.label || ''}
                                onChange={(event) => updateTemplateField(index, { label: event.target.value })}
                                InputProps={{ sx: { borderRadius: '8px' } }}
                                fullWidth
                              />
                            </Grid>

                            <Grid item xs={12} md={4}>
                              <FormControl size="small" fullWidth>
                                <InputLabel>Тип</InputLabel>
                                <Select
                                  label="Тип"
                                  value={fieldType}
                                  onChange={(event) => updateTemplateField(index, { type: String(event.target.value || 'text') })}
                                  sx={{ borderRadius: '8px' }}
                                >
                                  {(fieldTypes || []).map((typeItem) => (
                                    <MenuItem key={typeItem.value} value={typeItem.value}>{typeItem.label}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Grid>
                            <Grid item xs={12} md={4}>
                              <TextField
                                size="small"
                                label="Подсказка"
                                value={field?.placeholder || ''}
                                onChange={(event) => updateTemplateField(index, { placeholder: event.target.value })}
                                InputProps={{ sx: { borderRadius: '8px' } }}
                                fullWidth
                              />
                            </Grid>
                            <Grid item xs={12} md={4}>
                              <TextField
                                size="small"
                                label="Значение по умолчанию"
                                value={Array.isArray(field?.default_value) ? field.default_value.join(', ') : String(field?.default_value ?? '')}
                                onChange={(event) => updateTemplateField(index, { default_value: event.target.value })}
                                InputProps={{ sx: { borderRadius: '8px' } }}
                                fullWidth
                              />
                            </Grid>
                          </Grid>

                          <FormControlLabel
                            control={(
                              <Switch
                                size="small"
                                checked={Boolean(field?.required ?? true)}
                                onChange={(event) => updateTemplateField(index, { required: event.target.checked })}
                              />
                            )}
                            label={<Typography variant="caption">Обязательное поле</Typography>}
                            sx={{ m: 0 }}
                          />

                          {supportsOptions ? (
                            <TextField
                              size="small"
                              label="Опции (каждая с новой строки)"
                              value={optionsText}
                              onChange={(event) => updateTemplateField(index, { options: normalizeFieldOptions(event.target.value) })}
                              multiline
                              minRows={2}
                              InputProps={{ sx: { borderRadius: '8px' } }}
                              fullWidth
                            />
                          ) : null}
                        </Stack>
                      </Paper>
                    );
                  })}
                </Stack>
              </Paper>

              {(templateVariableHints || []).length > 0 ? (
                <Paper variant="outlined" sx={{ p: 1, borderRadius: '12px' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    Доступные переменные
                  </Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.7 }}>
                    {(templateVariableHints || []).map((variable) => (
                      <Chip key={variable} size="small" label={`{{${variable}}}`} variant="outlined" />
                    ))}
                  </Stack>
                </Paper>
              ) : null}

              <Paper variant="outlined" sx={{ p: 1.1, borderRadius: '12px', bgcolor: tokens.surfaceBg, borderColor: tokens.surfaceBorder, boxShadow: 'none' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Предпросмотр шаблона</Typography>
                <Box sx={{ mt: 0.7, whiteSpace: 'pre-wrap', fontSize: '0.84rem' }}>
                  {templateEditorPreview || 'Предпросмотр появится после заполнения шаблона.'}
                </Box>
              </Paper>
            </Stack>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Закрыть</Button>
        {canDelete ? (
          <Button
            color="error"
            onClick={deleteTemplate}
            disabled={templateDeleting || templateSaving}
            sx={{ textTransform: 'none' }}
          >
            {templateDeleting ? 'Удаление...' : 'Удалить'}
          </Button>
        ) : null}
        <Button
          variant="contained"
          onClick={saveTemplate}
          disabled={templateSaving || templateDeleting}
          sx={{ textTransform: 'none', borderRadius: '10px', fontWeight: 700 }}
        >
          {templateSaving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
