import { useEffect, useId, useMemo, useState } from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { searchHubCommands } from '../../lib/hubCommands';

export default function HubCommandPalette({
  open,
  commands = [],
  onClose,
  onExecute,
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => searchHubCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  const execute = (command) => {
    if (!command) return;
    onExecute?.(command);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (results.length ? (current + 1) % results.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      execute(results[activeIndex]);
    }
  };

  const activeOptionId = results[activeIndex] ? `${listId}-option-${activeIndex}` : undefined;

  return (
    <Dialog
      open={Boolean(open)}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={`${listId}-title`}
      PaperProps={{
        sx: {
          mt: { xs: 1, sm: '12vh' },
          alignSelf: 'flex-start',
          borderRadius: 2.5,
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle id={`${listId}-title`} sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
          <Typography component="span" variant="h6" sx={{ fontWeight: 800 }}>
            Быстрый переход
          </Typography>
          <Typography component="span" variant="caption" color="text.secondary">
            Ctrl+K
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important', px: 1.5, pb: 1.5, overscrollBehavior: 'contain' }}>
        <TextField
          autoFocus
          fullWidth
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
          label="Команда или раздел"
          placeholder="Например, задачи или диагностика"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon aria-hidden="true" />
              </InputAdornment>
            ),
          }}
          inputProps={{
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-controls': listId,
            'aria-expanded': true,
            'aria-activedescendant': activeOptionId,
          }}
        />
        <List
          id={listId}
          role="listbox"
          aria-label="Доступные команды HUB"
          sx={{ mt: 1, maxHeight: '52vh', overflowY: 'auto', py: 0.5 }}
        >
          {results.map((command, index) => (
            <ListItemButton
              id={`${listId}-option-${index}`}
              key={command.id}
              role="option"
              aria-selected={index === activeIndex}
              selected={index === activeIndex}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => execute(command)}
              sx={{ minHeight: 48, borderRadius: 1.5, mb: 0.25 }}
            >
              <ListItemText
                primary={command.label}
                secondary={command.description}
                primaryTypographyProps={{ fontWeight: 700 }}
              />
            </ListItemButton>
          ))}
          {results.length === 0 ? (
            <Box role="status" aria-live="polite" sx={{ px: 2, py: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">
                Подходящих команд нет
              </Typography>
            </Box>
          ) : null}
        </List>
      </DialogContent>
    </Dialog>
  );
}
