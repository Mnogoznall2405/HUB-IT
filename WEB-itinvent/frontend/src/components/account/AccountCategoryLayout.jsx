import { Box, ButtonBase, Paper, Stack, Typography, useMediaQuery } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../layout/MainLayout';
import PageShell from '../layout/PageShell';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

function CategoryButton({ category, selected, onClick }) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);
  return (
    <ButtonBase
      data-testid={`account-category-${category.key}`}
      onClick={onClick}
      sx={{
        width: '100%',
        minHeight: 58,
        p: 1,
        borderRadius: '14px',
        justifyContent: 'flex-start',
        textAlign: 'left',
        color: selected ? theme.palette.primary.main : ui.iconMuted,
        bgcolor: selected ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.09) : 'transparent',
        border: '1px solid',
        borderColor: selected ? alpha(theme.palette.primary.main, 0.26) : 'transparent',
        '&:hover': {
          bgcolor: selected ? alpha(theme.palette.primary.main, 0.14) : ui.actionHover,
        },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
        <Box sx={{ lineHeight: 0, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: 22 } }}>
          {category.icon}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ color: 'text.primary', fontWeight: selected ? 850 : 750, lineHeight: 1.15 }} noWrap>
            {category.label}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }} noWrap>
            {category.description}
          </Typography>
        </Box>
        <ChevronRightRoundedIcon sx={{ display: { xs: 'block', md: 'none' }, color: ui.iconMuted }} />
      </Stack>
    </ButtonBase>
  );
}

export default function AccountCategoryLayout({
  title,
  description,
  categories,
  activeKey,
  basePath,
  children,
  blockingError,
}) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const activeCategory = categories.find((item) => item.key === activeKey) || null;
  const showCategoryIndex = !isDesktop && !activeCategory;

  return (
    <MainLayout>
      <PageShell
        sx={{
          minHeight: 0,
          pb: { xs: 'calc(var(--app-shell-mobile-bottom-nav-height, 64px) + 10px)', md: 2 },
        }}
      >
        <Stack spacing={1.25} sx={{ maxWidth: 1180, mx: 'auto', width: '100%' }}>
          <Paper
            sx={{
              p: { xs: 1.35, md: 1.6 },
              borderRadius: '20px',
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.6),
              bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.74 : 0.78),
              backdropFilter: 'blur(20px) saturate(145%)',
              WebkitBackdropFilter: 'blur(20px) saturate(145%)',
              boxShadow: ui.shellShadow,
            }}
          >
            <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.05 }}>
              {showCategoryIndex ? title : (activeCategory?.label || title)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
              {showCategoryIndex ? description : (activeCategory?.description || description)}
            </Typography>
          </Paper>

          {blockingError || null}

          {showCategoryIndex ? (
            <Stack spacing={0.75}>
              {categories.map((category) => (
                <CategoryButton
                  key={category.key}
                  category={category}
                  selected={false}
                  onClick={() => navigate(`${basePath}/${category.key}`)}
                />
              ))}
            </Stack>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '244px minmax(0, 1fr)' },
                gap: 1.25,
                minHeight: 0,
              }}
            >
              <Paper
                sx={{
                  display: { xs: 'none', md: 'block' },
                  alignSelf: 'start',
                  position: 'sticky',
                  top: 'calc(var(--app-shell-top-offset, 0px) + 12px)',
                  p: 0.75,
                  borderRadius: '18px',
                  border: '1px solid',
                  borderColor: ui.borderSoft,
                  bgcolor: alpha(ui.panelSolid, theme.palette.mode === 'dark' ? 0.78 : 0.82),
                  backdropFilter: 'blur(18px)',
                  WebkitBackdropFilter: 'blur(18px)',
                  boxShadow: ui.shellShadow,
                }}
              >
                <Stack spacing={0.35}>
                  {categories.map((category) => (
                    <CategoryButton
                      key={category.key}
                      category={category}
                      selected={category.key === activeKey}
                      onClick={() => navigate(`${basePath}/${category.key}`)}
                    />
                  ))}
                </Stack>
              </Paper>

              <Stack spacing={1} sx={{ minWidth: 0 }}>
                <ButtonBase
                  onClick={() => navigate(basePath)}
                  sx={{
                    display: { xs: 'inline-flex', md: 'none' },
                    alignSelf: 'flex-start',
                    minHeight: 40,
                    px: 1,
                    borderRadius: '12px',
                    color: 'text.secondary',
                  }}
                >
                  <ArrowBackRoundedIcon sx={{ mr: 0.65, fontSize: 20 }} />
                  Все категории
                </ButtonBase>
                <Box sx={{ minWidth: 0 }}>
                  {children}
                </Box>
              </Stack>
            </Box>
          )}
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
