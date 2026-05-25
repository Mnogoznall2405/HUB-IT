import React, { useMemo } from 'react';
import {
  Box,
  Card,
  CardActionArea,
  Chip,
  Grid,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

export default function BranchList({
  branches,
  canEdit,
  onBranchClick,
  onEditClick,
  onDeleteClick,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);

  if (!branches || branches.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Филиалы не найдены.
      </Typography>
    );
  }

  return (
    <Grid container spacing={1.5}>
      {branches.map((branch) => (
        <Grid item xs={12} md={6} lg={4} key={branch.id}>
          <Card
            variant="outlined"
            sx={{
              height: '100%',
              bgcolor: ui.panelSolid,
              borderColor: ui.borderSoft,
              boxShadow: 'none',
              overflow: 'hidden',
            }}
          >
            <CardActionArea
              onClick={() => onBranchClick(branch)}
              sx={{ p: 0, height: '100%' }}
            >
              <Box sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h6" noWrap>{branch.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {branch.branch_code}
                    </Typography>
                  </Box>
                  {canEdit && (
                    <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onEditClick) onEditClick(branch);
                        }}
                        sx={{ bgcolor: ui.actionBg, '&:hover': { bgcolor: ui.actionHover }, minWidth: 36, minHeight: 36 }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onDeleteClick) onDeleteClick(branch);
                        }}
                        sx={{ bgcolor: ui.actionBg, '&:hover': { bgcolor: ui.actionHover }, minWidth: 36, minHeight: 36 }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  )}
                </Stack>
                <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                  <Chip size="small" label={`Уст: ${branch.devices_count || 0}`} />
                  <Chip size="small" label={`Порты: ${branch.ports_count || 0}`} />
                  <Chip size="small" label={`Роз: ${branch.sockets_count || 0}`} />
                  <Chip size="small" label={`Карты: ${branch.maps_count || 0}`} />
                  <Chip size="small" label={`Точ: ${branch.map_points_count || 0}`} />
                </Stack>
                {branch.default_site_code && (
                  <Typography variant="body2" color="primary" sx={{ mt: 1 }}>
                    Код сайта: {branch.default_site_code}
                  </Typography>
                )}
              </Box>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
