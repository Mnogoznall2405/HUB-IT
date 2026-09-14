import { useEffect, useId, useState } from 'react';
import { Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import { roleLabel } from './constructionShared';
import { addressBookAPI } from '../../api/addressBook';

function CorporateContacts({ employeeCode }) {
  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!employeeCode) return undefined;
    let active = true;
    setContacts(null);
    setError('');
    addressBookAPI.search({ q: employeeCode, limit: 200 }).then((response) => {
      if (!active) return;
      const matches = (response?.items || []).filter((item) => item.employee_code === employeeCode);
      const entry = matches.length === 1 ? matches[0] : null;
      setContacts({
        emails: (Array.isArray(entry?.work_emails) ? entry.work_emails : []).filter((item) => item?.value),
        phones: (Array.isArray(entry?.work_phones) ? entry.work_phones : []).filter((item) => item?.value),
      });
    }).catch((failure) => {
      if (active) setError(failure?.response?.status === 403
        ? 'Нет доступа к корпоративным контактам адресной книги.'
        : 'Не удалось загрузить корпоративные контакты.');
    });
    return () => { active = false; };
  }, [employeeCode, attempt]);
  if (!employeeCode) return <Typography variant="body2" color="text.secondary">Корпоративные контакты пока не привязаны к сотруднику.</Typography>;
  if (error) return <Box role="alert"><Typography variant="body2">{error}</Typography><Button onClick={() => setAttempt((value) => value + 1)}>Повторить</Button></Box>;
  if (!contacts) return <Typography variant="body2" role="status" color="text.secondary">Загрузка корпоративных контактов…</Typography>;
  return <Stack spacing={1.25}>
    {[
      ['Корпоративная почта', contacts.emails, 'mailto:'],
      ['Рабочие телефоны', contacts.phones, 'tel:'],
    ].map(([label, items, protocol]) => <Box key={label}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      {items.length ? items.map((item, index) => {
        const value = String(item.value).trim();
        const target = protocol === 'tel:' ? value.replace(/[^\d+*#,;]/g, '') : encodeURIComponent(value);
        return <Box key={`${value}-${index}`} sx={{ mt: 0.25 }}>
          {target ? <Link href={`${protocol}${target}`} sx={{ overflowWrap: 'anywhere' }}>{value}</Link> : <Typography variant="body2">{value}</Typography>}
          {item.kind ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item.kind}</Typography> : null}
        </Box>;
      }) : <Typography variant="body2" color="text.secondary">Не указаны в адресной книге</Typography>}
    </Box>)}
  </Stack>;
}

export default function ConstructionPersonLink({ member }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  useEffect(() => { setOpen(false); }, [member?.employee_code, member?.full_name]);
  if (!member?.full_name) return 'Не назначен';
  const initials = member.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('');

  return (
    <>
      <Link
        component="button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        underline="hover"
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
        sx={{ font: 'inherit', textAlign: 'left', overflowWrap: 'anywhere', verticalAlign: 'baseline', borderRadius: 0.5, py: 0.25, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3 } }}
      >
        {member.full_name}
      </Link>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby={titleId} fullWidth maxWidth="sm"
        onClick={(event) => event.stopPropagation()} PaperProps={{ sx: { borderRadius: 3, backgroundImage: 'none' } }}>
        <DialogTitle id={`${titleId}-header`} component="div" sx={{ p: { xs: 2, sm: 3 }, pr: 7, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={(theme) => ({ width: 56, height: 56, fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' })}>{initials || <PersonOutlineRoundedIcon />}</Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">Карточка сотрудника</Typography>
              <Typography id={titleId} component="h2" variant="h6" fontWeight={750} sx={{ overflowWrap: 'anywhere', lineHeight: 1.35 }}>{member.full_name}</Typography>
            </Box>
          </Stack>
          <IconButton aria-label="Закрыть карточку сотрудника" onClick={() => setOpen(false)} sx={{ position: 'absolute', top: 12, right: 12, width: 40, height: 40 }}><CloseRoundedIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: { xs: 2, sm: 3 }, pt: '24px !important' }}>
          {member.role_key ? <Chip size="small" label={roleLabel(member.role_key)} sx={{ mb: 2, maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }} /> : null}
          <Stack component="dl" spacing={2} sx={{ m: 0, overflowWrap: 'anywhere' }}>
            {[
              ['Должность', member.position],
              ['Подразделение', member.department],
              ['Местоположение подразделения', member.department_location],
            ].map(([label, value]) => value ? (
              <Box key={label}>
                <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
                <Typography component="dd" sx={{ m: 0, mt: 0.25 }}>{value}</Typography>
              </Box>
            ) : null)}
            {!member.position && !member.department && !member.department_location ? <Typography variant="body2" color="text.secondary">Дополнительные сведения о сотруднике пока не указаны.</Typography> : null}
          </Stack>
          {open ? <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <CorporateContacts key={member.employee_code || member.full_name} employeeCode={member.employee_code} />
          </Box> : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setOpen(false)} sx={{ textTransform: 'none', minHeight: 40 }}>Закрыть</Button></DialogActions>
      </Dialog>
    </>
  );
}
