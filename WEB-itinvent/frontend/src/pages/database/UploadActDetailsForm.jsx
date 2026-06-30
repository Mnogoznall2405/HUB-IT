import { memo } from 'react';

import { FormControlLabel, Grid, Switch, TextField } from '@mui/material';



const UploadActDetailsForm = memo(function UploadActDetailsForm({

  form,

  autoEmail = false,

  isMobile = false,

  onFieldChange,

  onInvNosChange,

  onAutoEmailChange,

}) {

  const fieldSize = isMobile ? 'medium' : 'small';



  return (

    <>

      <Grid container spacing={1.5}>

        <Grid item xs={12} md={6}>

          <TextField

            label="От сотрудника"

            value={form?.from_employee || ''}

            onChange={(event) => onFieldChange?.('from_employee', event.target.value)}

            helperText="Описание в документе сформируется автоматически при сохранении."

            fullWidth

            size={fieldSize}

          />

        </Grid>

        <Grid item xs={12} md={6}>

          <TextField

            label="На сотрудника"

            value={form?.to_employee || ''}

            onChange={(event) => onFieldChange?.('to_employee', event.target.value)}

            fullWidth

            size={fieldSize}

          />

        </Grid>

      </Grid>

      <Grid container spacing={1.5}>

        <Grid item xs={12} md={4}>

          <TextField

            label="Дата документа (YYYY-MM-DD)"

            value={form?.doc_date || ''}

            onChange={(event) => onFieldChange?.('doc_date', event.target.value)}

            fullWidth

            size={fieldSize}

            placeholder="2026-02-17"

          />

        </Grid>

        <Grid item xs={12} md={8}>

          <TextField

            label="Инв. № (через запятую)"

            value={form?.equipment_inv_nos_text || ''}

            onChange={(event) => onInvNosChange?.(event)}

            fullWidth

            size={fieldSize}

            placeholder="100887, 100888, 100889"

          />

        </Grid>

      </Grid>



      <FormControlLabel

        control={(

          <Switch

            checked={autoEmail}

            onChange={(event) => onAutoEmailChange?.(Boolean(event.target.checked))}

            color="primary"

          />

        )}

        label="Автоматически отправить акт на email участникам (От кого / На кого)"

        sx={{ mt: 0.5, mb: 0.5 }}

      />

    </>

  );

});



export default UploadActDetailsForm;

