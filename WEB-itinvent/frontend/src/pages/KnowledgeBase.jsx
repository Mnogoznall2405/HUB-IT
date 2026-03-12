import { useMemo } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { buildOfficeUiTokens, getOfficePanelSx } from '../theme/officeUiTokens';

const WIKI_URL = 'https://wiki.zsgp.ru/';

function KnowledgeBase() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const wikiHost = useMemo(() => {
    try {
      return new URL(WIKI_URL).host;
    } catch {
      return WIKI_URL;
    }
  }, []);

  const openInNewTab = () => {
    window.open(WIKI_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <MainLayout>
      <PageShell fullHeight>
        <Stack spacing={2} sx={{ height: '100%', minHeight: 0 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'center' }}
          >
            <Box>
              <Typography variant="h4">IT База знаний</Typography>
              <Typography variant="body2" color="text.secondary">
                Встроенный портал знаний: {wikiHost}
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<OpenInNewIcon />} onClick={openInNewTab}>
              Открыть в новой вкладке
            </Button>
          </Stack>

          <Alert severity="info">
            Если страница не отображается внутри портала, откройте wiki кнопкой выше. Это зависит от настроек безопасности сайта wiki.
          </Alert>

          <Paper variant="outlined" sx={{ ...getOfficePanelSx(ui, { flex: 1, minHeight: 0, overflow: 'hidden' }) }}>
            <Box
              component="iframe"
              src={WIKI_URL}
              title="IT Wiki"
              sx={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            />
          </Paper>
        </Stack>
      </PageShell>
    </MainLayout>
  );
}

export default KnowledgeBase;
