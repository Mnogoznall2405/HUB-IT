import { memo, useCallback, useEffect, useState } from 'react';
import { TextField } from '@mui/material';

const LocalTaskDescriptionField = memo(function LocalTaskDescriptionField({
  initialValue = '',
  onDraftChange,
  resetKey = '',
  ...props
}) {
  const [value, setValue] = useState(() => String(initialValue || ''));

  useEffect(() => {
    const nextValue = String(initialValue || '');
    setValue(nextValue);
    onDraftChange?.(nextValue);
  }, [initialValue, onDraftChange, resetKey]);

  const handleChange = useCallback((event) => {
    const nextValue = event.target.value;
    setValue(nextValue);
    onDraftChange?.(nextValue);
  }, [onDraftChange]);

  return (
    <TextField
      {...props}
      value={value}
      onChange={handleChange}
    />
  );
});

export default LocalTaskDescriptionField;
