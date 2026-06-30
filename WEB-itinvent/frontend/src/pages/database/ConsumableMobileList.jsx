import { memo, useMemo } from 'react';
import { Box, Typography } from '@mui/material';

import ConsumableListRow from './ConsumableListRow';

export function flattenConsumableDisplayData(displayData = {}) {
  const groups = [];
  Object.entries(displayData || {}).forEach(([branchName, locations]) => {
    const items = [];
    Object.values(locations || {}).forEach((locationItems) => {
      if (Array.isArray(locationItems)) {
        items.push(...locationItems);
      }
    });
    if (items.length > 0) {
      groups.push({ branchName, items });
    }
  });
  return groups;
}

function ConsumableMobileList({
  displayData,
  showBranchHeaders = true,
  onEditConsumableQty,
  onDeleteConsumable,
  canWrite = false,
  canDelete = false,
}) {
  const groups = useMemo(() => flattenConsumableDisplayData(displayData), [displayData]);

  if (groups.length === 0) return null;

  const showHeaders = showBranchHeaders && groups.length > 1;

  return (
    <Box data-testid="consumable-mobile-list">
      {groups.map(({ branchName, items }) => (
        <Box key={branchName}>
          {showHeaders ? (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                px: 1,
                py: 0.5,
                fontWeight: 700,
                color: 'text.secondary',
                bgcolor: 'action.hover',
              }}
            >
              {branchName}
            </Typography>
          ) : null}
          {items.map((item, index) => (
            <ConsumableListRow
              key={`${branchName}-${item?.ID || item?.INV_NO || index}`}
              item={item}
              onEditQty={onEditConsumableQty}
              onDelete={onDeleteConsumable}
              canWrite={canWrite}
              canDelete={canDelete}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

export default memo(ConsumableMobileList);
