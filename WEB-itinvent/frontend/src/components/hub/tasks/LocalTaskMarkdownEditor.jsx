import { memo, useCallback, useEffect, useState } from 'react';
import MarkdownEditor from '../MarkdownEditor';

const LocalTaskMarkdownEditor = memo(function LocalTaskMarkdownEditor({
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

  const handleChange = useCallback((nextValue) => {
    const normalizedValue = String(nextValue || '');
    setValue(normalizedValue);
    onDraftChange?.(normalizedValue);
  }, [onDraftChange]);

  return (
    <MarkdownEditor
      {...props}
      value={value}
      onChange={handleChange}
    />
  );
});

export default LocalTaskMarkdownEditor;
