import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import EditIcon from '@mui/icons-material/Edit';

import { buildProjectObjectCounts } from '../../../pages/tasks/taskAnalyticsViewModel';
import { getOfficeDialogPaperSx, getOfficeHeaderBandSx, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';

export default function TasksTaxonomyDialog({
  open = false,
  onClose,
  isMobile = false,
  ui,
  taxonomySaving = false,
  projectDraft,
  setProjectDraft,
  objectDraft,
  setObjectDraft,
  editingProjectId = '',
  editingObjectId = '',
  onSaveProject,
  onSaveObject,
  onEditProject,
  onEditObject,
  onResetProjectDraft,
  onResetObjectDraft,
  taskProjects = [],
  taskObjects = [],
  activeTaskProjects = [],
}) {
  const theme = useTheme();
  const projectObjectCounts = useMemo(() => buildProjectObjectCounts(taskObjects), [taskObjects]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
    >
      <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }), position: { xs: 'sticky', sm: 'static' }, top: 0, zIndex: 2 }}>
        <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Проекты и объекты</Typography>
        <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
          Справочники для постановки задач и аналитики по объектам.
        </Typography>
      </Box>
      <DialogContent sx={{ px: { xs: 1, sm: 2.2 }, py: { xs: 1, sm: 1.7 } }}>
        <Grid container spacing={1.4}>
          <Grid item xs={12} md={6}>
            <Stack spacing={1.1}>
              <Typography sx={{ fontWeight: 800 }}>
                {editingProjectId ? 'Редактирование проекта' : 'Новый проект'}
              </Typography>
              <TextField label="Название проекта" size="small" value={projectDraft.name} onChange={(event) => setProjectDraft((prev) => ({ ...prev, name: event.target.value }))} fullWidth />
              <TextField label="Код" size="small" value={projectDraft.code} onChange={(event) => setProjectDraft((prev) => ({ ...prev, code: event.target.value }))} fullWidth />
              <TextField label="Описание" size="small" value={projectDraft.description} onChange={(event) => setProjectDraft((prev) => ({ ...prev, description: event.target.value }))} multiline minRows={3} fullWidth />
              <FormControlLabel
                control={<Switch checked={projectDraft.is_active !== false} onChange={(event) => setProjectDraft((prev) => ({ ...prev, is_active: event.target.checked }))} />}
                label="Активный проект"
              />
              <Button variant="contained" onClick={() => void onSaveProject?.()} disabled={taxonomySaving || String(projectDraft.name || '').trim().length < 2} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                {editingProjectId ? 'Сохранить проект' : 'Добавить проект'}
              </Button>
              {editingProjectId ? (
                <Button variant="outlined" onClick={onResetProjectDraft} disabled={taxonomySaving} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                  Отменить редактирование
                </Button>
              ) : null}
              <Stack spacing={0.7}>
                {taskProjects.map((item) => (
                  <Box key={item.id} sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '12px' }) }}>
                    <Typography sx={{ fontWeight: 800 }}>{item.name}</Typography>
                    <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.45, mb: 0.25 }}>
                      <Chip
                        size="small"
                        label={item.is_active === false ? 'Архив' : 'Активен'}
                        sx={{ height: 22, fontWeight: 800, bgcolor: item.is_active === false ? alpha(theme.palette.text.secondary, 0.12) : alpha('#059669', 0.12), color: item.is_active === false ? 'text.secondary' : '#059669' }}
                      />
                      <Button size="small" variant="text" startIcon={<EditIcon sx={{ fontSize: 15 }} />} onClick={() => onEditProject?.(item)} sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, px: 0.5 }}>
                        Править
                      </Button>
                    </Stack>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>
                      {item.code || 'Без кода'}
                      {Number(projectObjectCounts[String(item.id)] || 0) > 0 ? ` · Объектов: ${projectObjectCounts[String(item.id)]}` : ''}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <Stack spacing={1.1}>
              <Typography sx={{ fontWeight: 800 }}>
                {editingObjectId ? 'Редактирование объекта' : 'Новый объект'}
              </Typography>
              <FormControl fullWidth size="small">
                <InputLabel id="taxonomy-project-label">Проект</InputLabel>
                <Select
                  labelId="taxonomy-project-label"
                  label="Проект"
                  value={objectDraft.project_id}
                  onChange={(event) => setObjectDraft((prev) => ({ ...prev, project_id: String(event.target.value || '') }))}
                >
                  {activeTaskProjects.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField label="Название объекта" size="small" value={objectDraft.name} onChange={(event) => setObjectDraft((prev) => ({ ...prev, name: event.target.value }))} fullWidth />
              <TextField label="Код" size="small" value={objectDraft.code} onChange={(event) => setObjectDraft((prev) => ({ ...prev, code: event.target.value }))} fullWidth />
              <TextField label="Описание" size="small" value={objectDraft.description} onChange={(event) => setObjectDraft((prev) => ({ ...prev, description: event.target.value }))} multiline minRows={3} fullWidth />
              <FormControlLabel
                control={<Switch checked={objectDraft.is_active !== false} onChange={(event) => setObjectDraft((prev) => ({ ...prev, is_active: event.target.checked }))} />}
                label="Активный объект"
              />
              <Button
                variant="contained"
                onClick={() => void onSaveObject?.()}
                disabled={taxonomySaving || !String(objectDraft.project_id || '').trim() || String(objectDraft.name || '').trim().length < 2}
                sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
              >
                {editingObjectId ? 'Сохранить объект' : 'Добавить объект'}
              </Button>
              {editingObjectId ? (
                <Button variant="outlined" onClick={onResetObjectDraft} disabled={taxonomySaving} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                  Отменить редактирование
                </Button>
              ) : null}
              <Stack spacing={0.7}>
                {taskObjects.map((item) => (
                  <Box key={item.id} sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '12px' }) }}>
                    <Typography sx={{ fontWeight: 800 }}>{item.name}</Typography>
                    <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.45, mb: 0.25 }}>
                      <Chip
                        size="small"
                        label={item.is_active === false ? 'Архив' : 'Активен'}
                        sx={{ height: 22, fontWeight: 800, bgcolor: item.is_active === false ? alpha(theme.palette.text.secondary, 0.12) : alpha('#2563eb', 0.12), color: item.is_active === false ? 'text.secondary' : '#2563eb' }}
                      />
                      <Button size="small" variant="text" startIcon={<EditIcon sx={{ fontSize: 15 }} />} onClick={() => onEditObject?.(item)} sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, px: 0.5 }}>
                        Править
                      </Button>
                    </Stack>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>
                      {taskProjects.find((project) => String(project.id) === String(item.project_id))?.name || 'Без проекта'}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Stack>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700 }}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
}
