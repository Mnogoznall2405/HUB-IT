import { Box, Breadcrumbs, Chip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { splitFolderPath } from '../../lib/groupsAccessUtils';

const FolderPathBreadcrumb = ({
  path,
  branch = '',
  compact = false,
  emphasize = false,
}) => {
  const theme = useTheme();
  const segments = splitFolderPath(path);
  const visibleSegments = compact && segments.length > 3
    ? ['…', ...segments.slice(-2)]
    : segments;

  if (!visibleSegments.length) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        Путь не указан
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        flexWrap: 'wrap',
      }}
    >
      {branch ? (
        <Chip
          size="small"
          label={branch}
          color="primary"
          variant="outlined"
          sx={{ height: 22, fontSize: '0.72rem' }}
        />
      ) : null}
      <Breadcrumbs
        separator={<ChevronRightIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
        aria-label="Путь к папке"
        sx={{
          '& .MuiBreadcrumbs-li': {
            display: 'flex',
            alignItems: 'center',
          },
        }}
      >
        {visibleSegments.map((segment, index) => {
          const isEllipsis = segment === '…';
          const isLast = index === visibleSegments.length - 1;
          return (
            <Box
              key={`${segment}-${index}`}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                px: isLast && emphasize ? 0.75 : 0,
                py: isLast && emphasize ? 0.2 : 0,
                borderRadius: 1,
                bgcolor: isLast && emphasize ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
              }}
            >
              {!isEllipsis && (isLast || emphasize) ? (
                <FolderOutlinedIcon sx={{ fontSize: 14, color: isLast ? 'primary.main' : 'text.secondary' }} />
              ) : null}
              <Typography
                variant="caption"
                sx={{
                  color: isLast ? 'text.primary' : 'text.secondary',
                  fontWeight: isLast && emphasize ? 600 : 500,
                  fontSize: emphasize ? '0.8rem' : '0.72rem',
                  lineHeight: 1.35,
                }}
              >
                {segment}
              </Typography>
            </Box>
          );
        })}
      </Breadcrumbs>
    </Box>
  );
};

export default FolderPathBreadcrumb;
