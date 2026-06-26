import { useCallback, useRef, useState } from 'react';
import {
  createEmptyOptionalSections,
  createInitialTaskDraft,
} from '../taskCreateModel';

export default function useTaskCreateForm() {
  const [createDuePickerOpen, setCreateDuePickerOpen] = useState(false);
  const [createDueCustomOpen, setCreateDueCustomOpen] = useState(false);
  const createDueAnchorRef = useRef(null);
  const [createMobileSheet, setCreateMobileSheet] = useState('');
  const [createDescriptionPreview, setCreateDescriptionPreview] = useState('');
  const [createOptionalSections, setCreateOptionalSections] = useState(createEmptyOptionalSections);
  const [createData, setCreateData] = useState(() => createInitialTaskDraft());
  const [createFiles, setCreateFiles] = useState([]);
  const [createChecklistItems, setCreateChecklistItems] = useState([]);
  const [createProjectName, setCreateProjectName] = useState('');
  const [createProjectSaving, setCreateProjectSaving] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const createDescriptionRef = useRef('');

  const handleCreateDescriptionDraftChange = useCallback((value) => {
    createDescriptionRef.current = String(value || '');
  }, []);

  return {
    createDuePickerOpen,
    setCreateDuePickerOpen,
    createDueCustomOpen,
    setCreateDueCustomOpen,
    createDueAnchorRef,
    createMobileSheet,
    setCreateMobileSheet,
    createDescriptionPreview,
    setCreateDescriptionPreview,
    createOptionalSections,
    setCreateOptionalSections,
    createData,
    setCreateData,
    createFiles,
    setCreateFiles,
    createChecklistItems,
    setCreateChecklistItems,
    createProjectName,
    setCreateProjectName,
    createProjectSaving,
    setCreateProjectSaving,
    createSaving,
    setCreateSaving,
    createDescriptionRef,
    handleCreateDescriptionDraftChange,
  };
}
