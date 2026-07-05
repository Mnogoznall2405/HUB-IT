import { useCallback, useState } from 'react';
import hubTaskSupportAPI from '../../../api/hubTaskSupport';import {
  createEmptyProjectDraft,
  createEmptyObjectDraft,
} from '../taskCreateModel';

export default function useTaskTaxonomy({ setError, loadTaskUsers }) {
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [taxonomySaving, setTaxonomySaving] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState('');
  const [editingObjectId, setEditingObjectId] = useState('');
  const [projectDraft, setProjectDraft] = useState(createEmptyProjectDraft);
  const [objectDraft, setObjectDraft] = useState(createEmptyObjectDraft);

  const handleCreateProject = useCallback(async () => {
    if (String(projectDraft.name || '').trim().length < 2) return;
    setTaxonomySaving(true);
    try {
      const payload = {
        name: String(projectDraft.name || '').trim(),
        code: String(projectDraft.code || '').trim(),
        description: String(projectDraft.description || '').trim(),
        is_active: projectDraft.is_active !== false,
      };
      if (editingProjectId) {
        await hubTaskSupportAPI.updateTaskProject(editingProjectId, payload);
      } else {
        await hubTaskSupportAPI.createTaskProject(payload);      }
      setEditingProjectId('');
      setProjectDraft(createEmptyProjectDraft());
      await loadTaskUsers({ force: true });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка создания проекта');
    } finally {
      setTaxonomySaving(false);
    }
  }, [editingProjectId, loadTaskUsers, projectDraft, setError]);

  const handleCreateObject = useCallback(async () => {
    if (!String(objectDraft.project_id || '').trim() || String(objectDraft.name || '').trim().length < 2) return;
    setTaxonomySaving(true);
    try {
      const payload = {
        project_id: String(objectDraft.project_id || '').trim(),
        name: String(objectDraft.name || '').trim(),
        code: String(objectDraft.code || '').trim(),
        description: String(objectDraft.description || '').trim(),
        is_active: objectDraft.is_active !== false,
      };
      if (editingObjectId) {
        await hubTaskSupportAPI.updateTaskObject(editingObjectId, payload);
      } else {
        await hubTaskSupportAPI.createTaskObject(payload);      }
      const retainedProjectId = editingObjectId ? '' : String(objectDraft.project_id || '');
      setEditingObjectId('');
      setObjectDraft(createEmptyObjectDraft(retainedProjectId));
      await loadTaskUsers({ force: true });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка создания объекта');
    } finally {
      setTaxonomySaving(false);
    }
  }, [editingObjectId, loadTaskUsers, objectDraft, setError]);

  const handleEditProject = useCallback((project) => {
    setEditingProjectId(String(project?.id || ''));
    setProjectDraft({
      name: String(project?.name || ''),
      code: String(project?.code || ''),
      description: String(project?.description || ''),
      is_active: project?.is_active !== false,
    });
  }, []);

  const handleEditObject = useCallback((taskObject) => {
    setEditingObjectId(String(taskObject?.id || ''));
    setObjectDraft({
      project_id: String(taskObject?.project_id || ''),
      name: String(taskObject?.name || ''),
      code: String(taskObject?.code || ''),
      description: String(taskObject?.description || ''),
      is_active: taskObject?.is_active !== false,
    });
  }, []);

  const resetProjectDraft = useCallback(() => {
    setEditingProjectId('');
    setProjectDraft(createEmptyProjectDraft());
  }, []);

  const resetObjectDraft = useCallback(() => {
    setEditingObjectId('');
    setObjectDraft(createEmptyObjectDraft());
  }, []);

  return {
    taxonomyOpen,
    setTaxonomyOpen,
    taxonomySaving,
    editingProjectId,
    editingObjectId,
    projectDraft,
    setProjectDraft,
    objectDraft,
    setObjectDraft,
    handleCreateProject,
    handleCreateObject,
    handleEditProject,
    handleEditObject,
    resetProjectDraft,
    resetObjectDraft,
  };
}
