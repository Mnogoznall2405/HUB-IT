import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { alpha, useTheme } from '@mui/material/styles';
import { hubAnnouncementsAPI } from '../../api/hubAnnouncements';
import { getFeedInitials } from './feedUtils';
import { getFeedReaction, getFeedReactionGroups } from './feedReactions';

export default function FeedReactionsDialog({
  open,
  post,
  initialReaction = '',
  onClose,
  notifyError,
}) {
  const theme = useTheme();
  const [activeReaction, setActiveReaction] = useState(initialReaction);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const groups = useMemo(
    () => getFeedReactionGroups(post?.reaction_counts),
    [post?.reaction_counts],
  );
  const total = groups.reduce((sum, reaction) => sum + reaction.count, 0);

  useEffect(() => {
    setActiveReaction(initialReaction || '');
  }, [initialReaction, post?.id]);

  useEffect(() => {
    if (!open || !post?.id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    hubAnnouncementsAPI.getReactionUsers(post.id, activeReaction)
      .then((payload) => {
        if (cancelled) return;
        const items = Array.isArray(payload) ? payload : payload?.items;
        setUsers(Array.isArray(items) ? items : []);
      })
      .catch((requestError) => {
        if (cancelled) return;
        setUsers([]);
        setError('Не удалось загрузить список реакций.');
        notifyError?.(requestError, 'Не удалось загрузить список реакций.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeReaction, notifyError, open, post?.id]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="feed-reactions-dialog-title"
      PaperProps={{ sx: { borderRadius: { xs: '18px 18px 0 0', sm: '16px' }, maxHeight: '82dvh', overscrollBehavior: 'contain' } }}
    >
      <DialogTitle id="feed-reactions-dialog-title" sx={{ pr: 7, fontWeight: 800 }}>
        Реакции
        <IconButton
          aria-label="Закрыть список реакций"
          onClick={onClose}
          sx={{ position: 'absolute', top: 8, right: 8, width: 44, height: 44 }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1.5 }}>
        <Stack
          direction="row"
          spacing={0.75}
          useFlexGap
          flexWrap="wrap"
          aria-label="Фильтр реакций"
          sx={{ mb: 1.5 }}
        >
          <Button
            size="small"
            aria-pressed={!activeReaction}
            onClick={() => setActiveReaction('')}
            sx={{ minHeight: 40, borderRadius: '999px', px: 1.25, textTransform: 'none', bgcolor: !activeReaction ? alpha(theme.palette.primary.main, 0.12) : 'transparent' }}
          >
            Все · {total}
          </Button>
          {groups.map((reaction) => (
            <Button
              key={reaction.id}
              size="small"
              aria-label={`${reaction.label}: ${reaction.count}`}
              aria-pressed={activeReaction === reaction.id}
              onClick={() => setActiveReaction(reaction.id)}
              sx={{ minWidth: 48, minHeight: 40, borderRadius: '999px', px: 1, gap: 0.5, textTransform: 'none', bgcolor: activeReaction === reaction.id ? alpha(theme.palette.primary.main, 0.12) : 'transparent' }}
            >
              <Box component="span" aria-hidden="true" sx={{ fontSize: 18, lineHeight: 1 }}>{reaction.emoji}</Box>
              {reaction.count}
            </Button>
          ))}
        </Stack>

        {loading ? (
          <Stack alignItems="center" role="status" aria-label="Загрузка реакций" sx={{ py: 4 }}><CircularProgress size={28} /></Stack>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : users.length ? (
          <Stack spacing={0.25}>
            {users.map((item) => {
              const reaction = getFeedReaction(String(item?.reaction_type || ''));
              const name = item?.full_name || item?.username || `Пользователь ${item?.user_id || ''}`;
              const username = item?.username ? `@${String(item.username).replace(/^@/, '')}` : '';
              return (
                <Stack key={`${item?.user_id || username}-${item?.reaction_type || ''}`} direction="row" alignItems="center" spacing={1.25} sx={{ minHeight: 56, px: 0.75, borderRadius: '12px' }}>
                  <Avatar sx={{ width: 40, height: 40, bgcolor: alpha(theme.palette.primary.main, 0.15), color: 'primary.main', fontSize: '0.82rem', fontWeight: 800 }}>{getFeedInitials(name)}</Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ fontWeight: 700 }}>{name}</Typography>
                    {username && username !== `@${name}` ? <Typography noWrap variant="caption" color="text.secondary">{username}</Typography> : null}
                  </Box>
                  {reaction ? <Box component="span" aria-label={reaction.label} title={reaction.label} sx={{ fontSize: 22, lineHeight: 1 }}>{reaction.emoji}</Box> : null}
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Typography role="status" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {activeReaction ? 'Эту реакцию пока никто не поставил.' : 'Реакций пока нет.'}
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
