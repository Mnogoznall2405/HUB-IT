import { Box } from '@mui/material';
import { formatMailSelfAwareName } from './mailCorrespondent';
import { getMailPersonEmail } from './mailPeople';

export default function MailPersonLink({
  person,
  mailboxEmails,
  onComposeToPerson,
  fallback = '',
  sx = {},
}) {
  const label = formatMailSelfAwareName(person, mailboxEmails, { fallback });
  if (!label) return null;
  const email = getMailPersonEmail(person);
  const clickable = Boolean(onComposeToPerson && email && label !== 'Вы');

  if (!clickable) {
    return (
      <Box component="span" sx={sx}>
        {label}
      </Box>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      data-testid="mail-person-link"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onComposeToPerson?.(person);
      }}
      sx={{
        border: 0,
        p: 0,
        m: 0,
        background: 'none',
        cursor: 'pointer',
        color: 'primary.main',
        font: 'inherit',
        fontWeight: 650,
        textAlign: 'left',
        '&:hover': { textDecoration: 'underline' },
        ...sx,
      }}
    >
      {label}
    </Box>
  );
}
