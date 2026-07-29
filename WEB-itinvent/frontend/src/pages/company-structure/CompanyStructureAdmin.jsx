import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SyncAltOutlinedIcon from '@mui/icons-material/SyncAltOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import { companyStructureAPI } from '../../api/companyStructure';
import CompanyStructureChart from './CompanyStructureChart';
import {
  NODE_TYPE_OPTIONS,
  collectDescendantIds,
  findNodeById,
  findNodePath,
  flattenTree,
  nodeCardTitle,
  resolveNodeTitle,
  usesZupDepartmentBinding,
} from './companyStructureModel';

const emptyDraft = () => ({
  title: '',
  node_type: 'department',
  person_name: '',
  person_position: '',
  parent_id: '',
  department_codes: [],
});

const editorToggleSx = {
  color: 'text.secondary',
  opacity: 1,
  '&.Mui-selected': { color: 'text.primary', bgcolor: 'action.selected' },
};

function defaultChildType(parent) {
  if (!parent) return 'root';
  if (parent.node_type === 'root') return 'block';
  if (parent.node_type === 'block') return 'deputy';
  if (parent.node_type === 'deputy') return 'directorate';
  return 'department';
}

function AdminTreeNode({ node, selectedId, expandedIds, onSelect, onToggle, depth = 0 }) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const expanded = expandedIds.has(String(node.id));
  return (
    <>
      <ListItemButton
        selected={String(selectedId) === String(node.id)}
        onClick={() => onSelect(String(node.id))}
        sx={{ pl: 0.5 + depth * 2, pr: 1, borderRadius: 1.5, mb: 0.25 }}
      >
        <Box sx={{ width: 30, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          {hasChildren ? (
            <IconButton
              size="small"
              aria-label={expanded ? 'Свернуть ветку' : 'Развернуть ветку'}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(String(node.id));
              }}
            >
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          ) : null}
        </Box>
        <ListItemText
          primary={nodeCardTitle(node)}
          secondary={NODE_TYPE_OPTIONS.find((item) => item.value === node.node_type)?.label || 'Узел'}
          primaryTypographyProps={{ variant: 'body2', fontWeight: 600, noWrap: true }}
          secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
        />
      </ListItemButton>
      {hasChildren && expanded
        ? node.children.map((child) => (
          <AdminTreeNode
            key={child.id}
            node={child}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onSelect={onSelect}
            onToggle={onToggle}
            depth={depth + 1}
          />
        ))
        : null}
    </>
  );
}

export default function CompanyStructureAdmin({
  tree,
  selectedId,
  selectedNode,
  peopleCount,
  onSelect,
  onChanged,
  notifySuccess,
  notifyApiError,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const flatNodes = useMemo(() => flattenTree(tree), [tree]);
  const selectedPath = useMemo(() => findNodePath(tree, selectedId), [selectedId, tree]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState('create');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState(emptyDraft);
  const [nameOptions, setNameOptions] = useState([]);
  const [nameQuery, setNameQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importOptions, setImportOptions] = useState([]);
  const [importSelection, setImportSelection] = useState([]);
  const [importQuery, setImportQuery] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [navigationView, setNavigationView] = useState('map');

  useEffect(() => {
    const pathIds = findNodePath(tree, selectedId).map((node) => String(node.id));
    setExpandedIds((current) => {
      const next = new Set(current);
      if (tree[0]?.id) next.add(String(tree[0].id));
      pathIds.forEach((id) => next.add(id));
      return next;
    });
  }, [selectedId, tree]);

  const showZupBinding = usesZupDepartmentBinding(draft.node_type);
  const isPersonCard = draft.node_type === 'deputy' || draft.node_type === 'root';
  useEffect(() => {
    if (!editorOpen || !showZupBinding) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      companyStructureAPI.searchDepartmentNames({ q: nameQuery || draft.title, limit: 100 })
        .then((payload) => {
          if (!cancelled) setNameOptions(Array.isArray(payload?.items) ? payload.items : []);
        })
        .catch(() => {
          if (!cancelled) setNameOptions([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft.title, editorOpen, nameQuery, showZupBinding]);

  useEffect(() => {
    if (!importOpen) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      companyStructureAPI.searchDepartmentNames({ q: importQuery, limit: importQuery ? 100 : 500 })
        .then((payload) => {
          if (!cancelled) setImportOptions(Array.isArray(payload?.items) ? payload.items : []);
        })
        .catch((error) => {
          if (!cancelled) {
            setImportOptions([]);
            notifyApiError?.(error, 'Не удалось получить подразделения из ЗУП.');
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [importOpen, importQuery, notifyApiError]);

  const openCreate = () => {
    setEditorMode('create');
    setEditingId('');
    setDraft({
      ...emptyDraft(),
      parent_id: selectedNode?.id || '',
      node_type: defaultChildType(selectedNode),
    });
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!selectedNode) return;
    setEditorMode('edit');
    setEditingId(String(selectedNode.id));
    setDraft({
      title: selectedNode.title || '',
      node_type: selectedNode.node_type || 'other',
      person_name: selectedNode.person_name || '',
      person_position: selectedNode.person_position || '',
      parent_id: selectedNode.parent_id || '',
      department_codes: Array.isArray(selectedNode.department_codes)
        ? [...selectedNode.department_codes]
        : [],
    });
    setEditorOpen(true);
  };

  const saveNode = async () => {
    const title = resolveNodeTitle(draft);
    if (!title) return;
    const payload = {
      title,
      node_type: draft.node_type,
      person_name: isPersonCard ? draft.person_name : '',
      person_position: isPersonCard ? draft.person_position : '',
      parent_id: draft.parent_id || null,
      department_codes: showZupBinding ? draft.department_codes : [],
    };
    setSaving(true);
    try {
      const saved = editorMode === 'create'
        ? await companyStructureAPI.createNode(payload)
        : await companyStructureAPI.updateNode(editingId, payload);
      setEditorOpen(false);
      notifySuccess?.(editorMode === 'create' ? 'Узел добавлен' : 'Изменения сохранены');
      await onChanged(String(saved.id));
    } catch (error) {
      notifyApiError?.(error, 'Не удалось сохранить узел.');
    } finally {
      setSaving(false);
    }
  };

  const importDepartments = async () => {
    if (!selectedNode || importSelection.length === 0) return;
    setSaving(true);
    try {
      const payload = await companyStructureAPI.importFromZup({
        parentId: selectedNode.id,
        departments: importSelection.map((item) => item.department),
      });
      const created = Array.isArray(payload?.created) ? payload.created : [];
      const skipped = Array.isArray(payload?.skipped) ? payload.skipped : [];
      setImportOpen(false);
      setImportSelection([]);
      notifySuccess?.(
        created.length
          ? `Добавлено из ЗУП: ${created.length}${skipped.length ? `, пропущено: ${skipped.length}` : ''}`
          : 'Новые подразделения не добавлены: выбранные уже есть в структуре.',
      );
      await onChanged(created[0]?.id || selectedNode.id);
    } catch (error) {
      notifyApiError?.(error, 'Не удалось добавить подразделения из ЗУП.');
    } finally {
      setSaving(false);
    }
  };

  const siblings = useMemo(() => {
    if (!selectedNode) return [];
    const parent = selectedNode.parent_id ? findNodeById(tree, selectedNode.parent_id) : null;
    return parent ? (parent.children || []) : tree;
  }, [selectedNode, tree]);
  const selectedPosition = siblings.findIndex((node) => String(node.id) === String(selectedId));

  const moveSelected = async (direction) => {
    if (!selectedNode || selectedPosition < 0) return;
    const position = direction === 'up' ? selectedPosition - 1 : selectedPosition + 1;
    if (position < 0 || position >= siblings.length) return;
    setSaving(true);
    try {
      await companyStructureAPI.moveNode(selectedNode.id, {
        parentId: selectedNode.parent_id || null,
        position,
      });
      await onChanged(selectedNode.id);
    } catch (error) {
      notifyApiError?.(error, 'Не удалось изменить порядок.');
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedNode) return;
    const hasChildren = Array.isArray(selectedNode.children) && selectedNode.children.length > 0;
    setSaving(true);
    try {
      await companyStructureAPI.deleteNode(selectedNode.id, { force: hasChildren });
      setDeleteOpen(false);
      notifySuccess?.('Узел удалён');
      await onChanged(selectedNode.parent_id || '');
    } catch (error) {
      notifyApiError?.(error, 'Не удалось удалить узел.');
    } finally {
      setSaving(false);
    }
  };

  const forbiddenParentIds = useMemo(() => {
    if (!editingId) return new Set();
    const editingNode = findNodeById(tree, editingId);
    const ids = collectDescendantIds(editingNode);
    ids.add(String(editingId));
    return ids;
  }, [editingId, tree]);

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={navigationView}
        onChange={(_, value) => value && setNavigationView(value)}
        aria-label="Вид редактора структуры"
        sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
      >
        <ToggleButton value="map" sx={{ ...editorToggleSx, flex: { xs: 1, sm: 'initial' } }}>
          <AccountTreeOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
          Карта
        </ToggleButton>
        <ToggleButton value="tree" sx={{ ...editorToggleSx, flex: { xs: 1, sm: 'initial' } }}>
          <ViewListOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />
          Дерево
        </ToggleButton>
      </ToggleButtonGroup>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={2}
        alignItems="flex-start"
      >
        {navigationView === 'map' ? (
          <Box sx={{ flex: 1, minWidth: 0, width: { xs: '100%', lg: 'auto' } }}>
            <CompanyStructureChart
              tree={tree}
              selectedId={selectedId}
              onSelect={onSelect}
              isMobile={isMobile}
            />
          </Box>
        ) : (
          <Paper variant="outlined" sx={{ width: { xs: '100%', lg: 380 }, flexShrink: 0, borderRadius: 2 }}>
          <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ p: 1.5 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>Иерархия</Typography>
              <Typography variant="caption" color="text.secondary">Нажмите на узел, чтобы управлять им</Typography>
            </Box>
            <Button size="small" startIcon={<AddIcon />} onClick={openCreate} disabled={!selectedNode}>
              Вручную
            </Button>
          </Stack>
          <Divider />
          <List dense sx={{ maxHeight: { xs: 360, lg: '66vh' }, overflow: 'auto', p: 1 }}>
            {tree.map((node) => (
              <AdminTreeNode
                key={node.id}
                node={node}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={onSelect}
                onToggle={(nodeId) => setExpandedIds((current) => {
                  const next = new Set(current);
                  if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
                  return next;
                })}
              />
            ))}
          </List>
          </Paper>
        )}

        <Paper
          variant="outlined"
          sx={{
            flex: navigationView === 'map' ? { xs: '1 1 auto', lg: '0 0 380px' } : 1,
            width: navigationView === 'map' ? { xs: '100%', lg: 380 } : 'auto',
            minWidth: 0,
            p: { xs: 2, md: 2.5 },
            borderRadius: 2,
            position: { lg: 'sticky' },
            top: { lg: 16 },
          }}
        >
          {selectedNode ? (
            <Stack spacing={2}>
              <Box>
                <Typography variant="overline" color="text.secondary">
                  {selectedPath.slice(0, -1).map(nodeCardTitle).join(' / ') || 'Верхний уровень'}
                </Typography>
                <Typography variant="h6" fontWeight={700}>{nodeCardTitle(selectedNode)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {NODE_TYPE_OPTIONS.find((item) => item.value === selectedNode.node_type)?.label || 'Узел структуры'}
                </Typography>
              </Box>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Button variant="contained" startIcon={<SyncAltOutlinedIcon />} onClick={() => setImportOpen(true)}>
                  Добавить из ЗУП
                </Button>
                <Button startIcon={<AddIcon />} onClick={openCreate}>Добавить вручную</Button>
                <Button startIcon={<EditOutlinedIcon />} onClick={openEdit}>Изменить</Button>
                <Button
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => setDeleteOpen(true)}
                  disabled={!selectedNode.parent_id}
                >
                  Удалить
                </Button>
              </Stack>
              <Divider />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">Родитель</Typography>
                  <Typography variant="body2">
                    {selectedPath.length > 1 ? nodeCardTitle(selectedPath[selectedPath.length - 2]) : 'Нет — корневой узел'}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">Дочерние узлы</Typography>
                  <Typography variant="body2">{selectedNode.children?.length || 0}</Typography>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">Сотрудники из ЗУП</Typography>
                  <Typography variant="body2">{peopleCount}</Typography>
                </Box>
              </Stack>
              {selectedNode.person_name || selectedNode.person_position ? (
                <Box>
                  <Typography variant="caption" color="text.secondary">Карточка руководителя</Typography>
                  <Typography variant="body2">{[selectedNode.person_name, selectedNode.person_position].filter(Boolean).join(' · ')}</Typography>
                </Box>
              ) : null}
              <Box>
                <Typography variant="caption" color="text.secondary">Коды подразделений ЗУП</Typography>
                <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 0.5 }}>
                  {(selectedNode.department_codes || []).length
                    ? selectedNode.department_codes.map((code) => <Chip size="small" key={code} label={code} />)
                    : <Typography variant="body2" color="text.secondary">Нет привязки</Typography>}
                </Stack>
              </Box>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Порядок среди соседних:</Typography>
                <IconButton
                  size="small"
                  aria-label="Переместить выше"
                  disabled={saving || selectedPosition <= 0}
                  onClick={() => void moveSelected('up')}
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Переместить ниже"
                  disabled={saving || selectedPosition < 0 || selectedPosition >= siblings.length - 1}
                  onClick={() => void moveSelected('down')}
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <Typography variant="caption" color="text.secondary">
                  {selectedPosition >= 0 ? `${selectedPosition + 1} из ${siblings.length}` : '—'}
                </Typography>
              </Stack>
            </Stack>
          ) : (
            <Typography color="text.secondary">Выберите узел в дереве.</Typography>
          )}
        </Paper>
      </Stack>

      <Dialog open={importOpen} onClose={() => !saving && setImportOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Добавить подразделения из ЗУП</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="success">
              Новые узлы будут добавлены внутрь «{nodeCardTitle(selectedNode)}». Сотрудники и рабочие контакты подтянутся автоматически.
            </Alert>
            <Autocomplete
              multiple
              filterSelectedOptions
              options={importOptions}
              value={importSelection}
              getOptionLabel={(option) => option?.department || ''}
              isOptionEqualToValue={(option, value) => option?.department === value?.department}
              onInputChange={(_, value) => setImportQuery(value)}
              onChange={(_, value) => setImportSelection(value)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  autoFocus
                  label="Подразделения ЗУП"
                  placeholder="Начните вводить название"
                  helperText="Можно выбрать несколько подразделений одного уровня. Уже импортированные будут пропущены."
                />
              )}
              renderOption={(props, option) => (
                <li {...props} key={option.department}>
                  <ListItemText
                    primary={option.department}
                    secondary={`${option.people_count || 0} сотрудников${option.department_location ? ` · ${option.department_location}` : ''}`}
                  />
                </li>
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)} disabled={saving}>Отмена</Button>
          <Button
            variant="contained"
            onClick={() => void importDepartments()}
            disabled={saving || importSelection.length === 0}
          >
            Добавить {importSelection.length || ''}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editorMode === 'create' ? 'Добавить узел вручную' : 'Изменить узел'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Тип узла</InputLabel>
              <Select
                label="Тип узла"
                value={draft.node_type}
                onChange={(event) => setDraft((current) => ({ ...current, node_type: event.target.value }))}
              >
                {NODE_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {showZupBinding ? (
              <Autocomplete
                freeSolo
                options={nameOptions}
                value={draft.title}
                getOptionLabel={(option) => (typeof option === 'string' ? option : option?.department || '')}
                onInputChange={(_, value, reason) => {
                  setNameQuery(value);
                  if (reason !== 'reset') setDraft((current) => ({ ...current, title: value }));
                }}
                onChange={(_, value) => {
                  const meta = typeof value === 'object' ? value : null;
                  const title = meta?.department || String(value || '');
                  setDraft((current) => ({
                    ...current,
                    title,
                    department_codes: meta?.department_codes || current.department_codes,
                  }));
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Название подразделения" helperText="Для подразделения выберите точное название из ЗУП." required />
                )}
              />
            ) : (
              <TextField
                label="Название"
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                fullWidth
                required={!isPersonCard}
              />
            )}
            {isPersonCard ? (
              <>
                <TextField
                  label="ФИО руководителя"
                  value={draft.person_name}
                  onChange={(event) => setDraft((current) => ({ ...current, person_name: event.target.value }))}
                  fullWidth
                />
                <TextField
                  label="Должность"
                  value={draft.person_position}
                  onChange={(event) => setDraft((current) => ({ ...current, person_position: event.target.value }))}
                  fullWidth
                />
              </>
            ) : null}
            <FormControl fullWidth>
              <InputLabel>Родительский узел</InputLabel>
              <Select
                label="Родительский узел"
                value={draft.parent_id || ''}
                onChange={(event) => setDraft((current) => ({ ...current, parent_id: event.target.value }))}
              >
                <MenuItem value="">Без родителя</MenuItem>
                {flatNodes.filter((node) => !forbiddenParentIds.has(String(node.id))).map((node) => (
                  <MenuItem key={node.id} value={node.id}>
                    {'—'.repeat(node.depth)} {nodeCardTitle(node)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditorOpen(false)} disabled={saving}>Отмена</Button>
          <Button variant="contained" onClick={() => void saveNode()} disabled={saving || !resolveNodeTitle(draft)}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => !saving && setDeleteOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Удалить «{nodeCardTitle(selectedNode)}»?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {selectedNode?.children?.length
              ? `Дочерние узлы (${selectedNode.children.length}) будут переподчинены родителю удаляемого узла.`
              : 'Узел исчезнет из структуры. Данные в ЗУП не изменятся.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={saving}>Отмена</Button>
          <Button color="error" variant="contained" onClick={() => void deleteSelected()} disabled={saving}>Удалить</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
