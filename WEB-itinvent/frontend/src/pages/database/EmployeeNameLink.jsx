import { Link, Typography } from '@mui/material';

export default function EmployeeNameLink({
  name,
  ownerNo,
  onOpenEmployee,
  variant = 'body2',
  noWrap = false,
  sx,
}) {
  const displayName = String(name || '').trim() || '-';
  const normalizedOwnerNo = ownerNo ?? null;
  const canOpen = Boolean(onOpenEmployee && normalizedOwnerNo && displayName !== '-');

  if (!canOpen) {
    return (
      <Typography variant={variant} noWrap={noWrap} sx={sx}>
        {displayName}
      </Typography>
    );
  }

  return (
    <Link
      component="button"
      type="button"
      variant={variant}
      underline="hover"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenEmployee({ ownerNo: normalizedOwnerNo, employeeName: displayName });
      }}
      sx={{
        textAlign: 'left',
        fontWeight: 500,
        ...(noWrap ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
        ...sx,
      }}
    >
      {displayName}
    </Link>
  );
}
