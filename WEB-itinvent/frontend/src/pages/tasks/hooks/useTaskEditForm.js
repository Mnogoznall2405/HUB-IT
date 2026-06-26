import { useCallback, useRef, useState } from 'react';

const initialEditData = {
  id: '',
  title: '',
  description: '',
  due_at: '',
  protocol_date: '',
  priority: 'normal',
  project_id: '',
  object_id: '',
  assignee_user_id: '',
  controller_user_id: '',
  observer_user_ids: [],
  department_id: '',
  visibility_scope: 'private',
  email_deadline_remind_mode: 'default',
  email_deadline_remind_hours: 24,
};

export default function useTaskEditForm() {
  const [editSaving, setEditSaving] = useState(false);
  const [editData, setEditData] = useState(initialEditData);
  const [editDueCustomOpen, setEditDueCustomOpen] = useState(false);
  const editDescriptionRef = useRef('');

  const handleEditDescriptionDraftChange = useCallback((value) => {
    editDescriptionRef.current = String(value || '');
  }, []);

  return {
    editSaving,
    setEditSaving,
    editData,
    setEditData,
    editDueCustomOpen,
    setEditDueCustomOpen,
    editDescriptionRef,
    handleEditDescriptionDraftChange,
  };
}
