import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContactSupportOutlinedIcon from '@mui/icons-material/ContactSupportOutlined';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { Link as RouterLink } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import MobileShellPageHeader from '../components/layout/MobileShellPageHeader';
import PageShell from '../components/layout/PageShell';
import { useAuth } from '../contexts/AuthContext';
import { getVisibleNavigationItems } from '../components/layout/navigationConfig';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';
import {
  HELP_UPDATED_AT,
  SECTION_GUIDES,
  SUPPORT_EMAIL,
  TOPICS,
} from './help/helpContent';
import KbHelpSection from './help/KbHelpSection';

const TOPIC_ACCENTS = ['primary', 'secondary', 'success', 'warning', 'info', 'error'];

const topicItemMeta = (topic, count) => {
  if (topic.layout === 'nav') return `${count} разделов`;
  if (topic.layout === 'qa') return `${count} вопросов`;
  return `${count} шагов`;
};

function TopicImage({ image }) {
  if (!image) return null;
  return (
    <Box component="figure" sx={{ m: 0 }}>
      <Box
        component="img"
        src={image.src}
        alt={image.alt}
        loading="lazy"
        sx={{
          display: 'block',
          width: '100%',
          maxHeight: 220,
          objectFit: 'cover',
          objectPosition: 'top',
          borderRadius: '10px',
          border: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      />
      {image.caption ? (
        <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {image.caption}
        </Typography>
      ) : null}
    </Box>
  );
}

function StepLink({ link }) {
  if (!link) return null;
  return (
    <Link
      component={RouterLink}
      to={link.to}
      underline="hover"
      variant="caption"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mt: 0.25, fontWeight: 700 }}
    >
      {link.label}
      <ArrowForwardRoundedIcon sx={{ fontSize: 14 }} />
    </Link>
  );
}

function StepsList({ items }) {
  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1.5 }}>
      {items.map((step, index) => (
        <Box component="li" key={step.title} sx={{ display: 'flex', gap: 1.25 }}>
          <Box
            aria-hidden="true"
            sx={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 800,
              flexShrink: 0,
              mt: '1px',
            }}
          >
            {index + 1}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={800}>{step.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
              {step.text}
            </Typography>
            <StepLink link={step.link} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function QaList({ items }) {
  return (
    <Stack spacing={1.25}>
      {items.map((item) => (
        <Box key={item.q}>
          <Typography variant="body2" fontWeight={800}>{item.q}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
            {item.a}
          </Typography>
          <StepLink link={item.link} />
        </Box>
      ))}
    </Stack>
  );
}

function NavList({ items }) {
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}>
      {items.map((item) => (
        <Box component="li" key={item.key} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '8px',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              bgcolor: 'action.hover',
              color: 'primary.main',
              '& svg': { fontSize: 18 },
            }}
          >
            {item.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={800}>{item.title}</Typography>
            {item.text ? (
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                {item.text}
              </Typography>
            ) : null}
            {item.how?.length ? (
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2, display: 'grid', gap: 0.25 }}>
                {item.how.map((hint) => (
                  <Typography component="li" variant="caption" color="text.secondary" key={hint} sx={{ lineHeight: 1.45 }}>
                    {hint}
                  </Typography>
                ))}
              </Box>
            ) : null}
            <Link
              component={RouterLink}
              to={item.path}
              underline="hover"
              variant="caption"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mt: 0.5, fontWeight: 700 }}
            >
              Открыть раздел
              <ArrowForwardRoundedIcon sx={{ fontSize: 14 }} />
            </Link>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default function Help() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { user, hasPermission } = useAuth();
  const [query, setQuery] = useState('');
  const [openTopicId, setOpenTopicId] = useState('');

  const allowed = (permissions) => (
    !permissions?.length || permissions.some((permission) => hasPermission(permission))
  );

  const visibleTopics = useMemo(() => {
    const navigationItems = getVisibleNavigationItems({ user, hasPermission })
      .filter((item) => item.path !== '/help')
      .map((item) => ({
        key: item.path,
        path: item.path,
        icon: item.icon,
        title: item.label,
        text: SECTION_GUIDES[item.path]?.what || '',
        how: SECTION_GUIDES[item.path]?.how || [],
      }));

    return TOPICS
      .filter((topic) => allowed(topic.permissions))
      .map((topic) => {
        if (topic.layout === 'nav') return { ...topic, navItems: navigationItems };
        const rawItems = topic.layout === 'qa' ? topic.items : topic.steps;
        return { ...topic, items: rawItems.filter((item) => allowed(item.permissions)) };
      })
      .filter((topic) => (
        topic.layout === 'nav' ? topic.navItems.length > 0 : topic.items.length > 0
      ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hasPermission]);

  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return visibleTopics.flatMap((topic) => {
      const entries = topic.layout === 'nav' ? topic.navItems : topic.items;
      return entries
        .filter((entry) => (
          [entry.title, entry.text, entry.q, entry.a, ...(entry.how || [])]
            .filter(Boolean)
            .some((part) => part.toLowerCase().includes(normalizedQuery))
          || topic.title.toLowerCase().includes(normalizedQuery)
        ))
        .map((entry) => ({
          topic,
          key: entry.key || entry.title || entry.q,
          title: entry.title || entry.q,
          text: entry.text || entry.a || '',
        }));
    });
  }, [normalizedQuery, visibleTopics]);

  const openTopic = visibleTopics.find((topic) => topic.id === openTopicId) || null;

  return (
    <MainLayout>
      <PageShell sx={{ gap: { xs: 1, sm: 1.5 }, pb: { xs: 1, sm: 1.5 } }}>
        {isMobile ? (
          <MobileShellPageHeader title="Справка и база знаний" sx={{ mb: 0, flexShrink: 0, minHeight: 40 }} />
        ) : null}

        <Stack spacing={{ xs: 1, sm: 1.5 }} sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Paper
            variant="outlined"
            sx={getOfficePanelSx(ui, {
              borderRadius: '20px',
              px: { xs: 2, sm: 3 },
              py: { xs: 3, sm: 4 },
              boxShadow: 'none',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
              background: (t) => {
                const isDark = t.palette.mode === 'dark';
                const primary = t.palette.primary.main;
                const secondary = t.palette.secondary?.main || primary;
                return [
                  `radial-gradient(420px 160px at 12% -40px, ${isDark ? 'rgba(255,255,255,0.05)' : `${primary}1a`}, transparent 70%)`,
                  `radial-gradient(360px 160px at 88% -30px, ${isDark ? `${primary}2b` : `${secondary}14`}, transparent 70%)`,
                  `linear-gradient(165deg, ${isDark ? `${t.palette.primary.dark}26` : `${primary}12`}, transparent 65%)`,
                ].join(', ');
              },
            })}
          >
            <Stack spacing={1.1} alignItems="center">
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  borderRadius: '16px',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'primary.contrastText',
                  background: (t) => `linear-gradient(150deg, ${t.palette.primary.light}, ${t.palette.primary.main})`,
                  boxShadow: (t) => `0 8px 20px ${t.palette.primary.main}40`,
                }}
              >
                <HelpOutlineRoundedIcon sx={{ fontSize: 28 }} />
              </Box>
              <Typography variant="h5" fontWeight={800}>Чем помочь?</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
                Пошаговые инструкции по работе в HUB и файлы базы знаний — показаны только разделы, доступные вам.
                Обзор возможностей со скриншотами — на странице{' '}
                <Link component={RouterLink} to="/settings/about" underline="always">«О HUB»</Link>.
              </Typography>
              <TextField
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск: пароль, заявление, почта, инструкция…"
                fullWidth
                size="small"
                inputProps={{ 'aria-label': 'Поиск по справке и базе знаний' }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: query ? (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setQuery('')} aria-label="Очистить поиск">
                        <CloseRoundedIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
                sx={{
                  maxWidth: 520,
                  mt: 0.75,
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '999px',
                    bgcolor: 'background.paper',
                    transition: 'box-shadow 140ms ease, border-color 140ms ease',
                    '&.Mui-focused': {
                      boxShadow: (t) => `0 0 0 3px ${t.palette.primary.main}26`,
                    },
                  },
                }}
              />
              <Typography variant="caption" color="text.disabled">
                Обновлено: {HELP_UPDATED_AT}
              </Typography>
            </Stack>
          </Paper>

          {normalizedQuery ? (
            <Paper variant="outlined" sx={getOfficePanelSx(ui, { borderRadius: '14px', p: 1.5, boxShadow: 'none' })}>
              {searchResults.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  Ничего не нашлось — попробуйте другие слова или напишите на{' '}
                  <Link href={`mailto:${SUPPORT_EMAIL}`} underline="always">{SUPPORT_EMAIL}</Link>.
                </Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}>
                  {searchResults.map(({ topic, key, title, text }) => (
                    <Box component="li" key={`${topic.id}:${key}`} sx={{ display: 'flex', gap: 1 }}>
                      <Typography component="span" variant="caption" color="primary" sx={{ flexShrink: 0, fontWeight: 800, pt: '2px', minWidth: { xs: 90, sm: 130 } }}>
                        {topic.title}
                      </Typography>
                      <Typography variant="body2" sx={{ lineHeight: 1.55 }}>
                        <b>{title}</b>{text ? ` — ${text}` : ''}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' },
                gap: { xs: 1, sm: 1.5 },
              }}
            >
              {visibleTopics.map((topic, topicIndex) => {
                const count = topic.layout === 'nav' ? topic.navItems.length : topic.items.length;
                const Icon = topic.icon;
                const accent = TOPIC_ACCENTS[topicIndex % TOPIC_ACCENTS.length];
                return (
                  <Paper
                    key={topic.id}
                    component="button"
                    type="button"
                    variant="outlined"
                    onClick={() => setOpenTopicId(topic.id)}
                    sx={getOfficePanelSx(ui, {
                      borderRadius: '16px',
                      p: 1.5,
                      boxShadow: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 1.25,
                      alignItems: 'flex-start',
                      transition: 'transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease',
                      '&:hover': {
                        borderColor: `${accent}.main`,
                        transform: 'translateY(-2px)',
                        boxShadow: ui.shellShadow,
                      },
                      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                    })}
                  >
                    <Box
                      sx={(t) => {
                        const color = t.palette[accent]?.main || t.palette.primary.main;
                        return {
                          width: 38,
                          height: 38,
                          borderRadius: '11px',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                          color,
                          bgcolor: t.palette.mode === 'dark' ? `${color}2e` : `${color}1a`,
                          border: '1px solid',
                          borderColor: t.palette.mode === 'dark' ? `${color}4d` : `${color}2e`,
                        };
                      }}
                    >
                      <Icon fontSize="small" />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="subtitle2" fontWeight={800}>{topic.title}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.4 }}>
                        {topic.description}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={topicItemMeta(topic, count)}
                        sx={{ mt: 0.75, height: 20, fontSize: '0.7rem' }}
                      />
                    </Box>
                  </Paper>
                );
              })}

              <Paper
                variant="outlined"
                sx={getOfficePanelSx(ui, {
                  borderRadius: '14px',
                  p: 1.5,
                  boxShadow: 'none',
                  display: 'flex',
                  gap: 1.25,
                  alignItems: 'flex-start',
                  bgcolor: 'action.hover',
                })}
              >
                <Box
                  sx={(t) => ({
                    width: 38,
                    height: 38,
                    borderRadius: '11px',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    color: 'text.secondary',
                    bgcolor: t.palette.mode === 'dark' ? `${t.palette.text.secondary}26` : `${t.palette.text.secondary}14`,
                    border: '1px solid',
                    borderColor: 'divider',
                  })}
                >
                  <ContactSupportOutlinedIcon fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" fontWeight={800}>Нужна помощь?</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.4 }}>
                    Напишите в техническую поддержку:{' '}
                    <Link href={`mailto:${SUPPORT_EMAIL}`} underline="always">{SUPPORT_EMAIL}</Link>
                  </Typography>
                </Box>
              </Paper>
            </Box>
          )}

          <KbHelpSection query={normalizedQuery} ui={ui} />
        </Stack>

        <Dialog
          open={Boolean(openTopic)}
          onClose={() => setOpenTopicId('')}
          fullWidth
          maxWidth="sm"
          fullScreen={isMobile}
          aria-labelledby={openTopic ? `help-topic-${openTopic.id}` : undefined}
        >
          {openTopic ? (
            <>
              <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pr: 6 }}>
                <openTopic.icon color="primary" />
                <Typography component="span" variant="h6" fontWeight={800} id={`help-topic-${openTopic.id}`}>
                  {openTopic.title}
                </Typography>
                <IconButton
                  onClick={() => setOpenTopicId('')}
                  aria-label="Закрыть"
                  sx={{ position: 'absolute', right: 8, top: 8 }}
                >
                  <CloseRoundedIcon />
                </IconButton>
              </DialogTitle>
              <DialogContent dividers>
                <Stack spacing={1.5}>
                  <TopicImage image={openTopic.image} />
                  {openTopic.layout === 'nav' ? <NavList items={openTopic.navItems} /> : null}
                  {openTopic.layout === 'steps' ? <StepsList items={openTopic.items} /> : null}
                  {openTopic.layout === 'qa' ? <QaList items={openTopic.items} /> : null}
                </Stack>
              </DialogContent>
            </>
          ) : null}
        </Dialog>
      </PageShell>
    </MainLayout>
  );
}
