import { fireEvent, render, screen } from '@testing-library/react';

import { describe, expect, it, vi } from 'vitest';



import UploadActDetailsForm from './UploadActDetailsForm';



const baseForm = {

  from_employee: 'Иванов И.И.',

  to_employee: 'Петров П.П.',

  doc_date: '2026-02-17',

  equipment_inv_nos_text: '100887, 100888',

};



describe('UploadActDetailsForm', () => {

  it('renders controlled act fields', () => {

    render(<UploadActDetailsForm form={baseForm} autoEmail />);



    expect(screen.getByText(/Описание в документе сформируется автоматически/i)).toBeInTheDocument();

    expect(screen.getByLabelText('От сотрудника')).toHaveValue('Иванов И.И.');

    expect(screen.getByLabelText('На сотрудника')).toHaveValue('Петров П.П.');

    expect(screen.getByLabelText('Дата документа (YYYY-MM-DD)')).toHaveValue('2026-02-17');

    expect(screen.getByLabelText('Инв. № (через запятую)')).toHaveValue('100887, 100888');

    expect(screen.getByLabelText('Автоматически отправить акт на email участникам (От кого / На кого)')).toBeChecked();

  });



  it('notifies parent about field, inv list, and auto-email changes', () => {

    const onFieldChange = vi.fn();

    const onInvNosChange = vi.fn();

    const onAutoEmailChange = vi.fn();



    render(

      <UploadActDetailsForm

        form={baseForm}

        autoEmail

        onFieldChange={onFieldChange}

        onInvNosChange={onInvNosChange}

        onAutoEmailChange={onAutoEmailChange}

      />

    );



    fireEvent.change(screen.getByLabelText('От сотрудника'), { target: { value: 'Сидоров С.С.' } });

    fireEvent.change(screen.getByLabelText('Инв. № (через запятую)'), { target: { value: '100999' } });

    fireEvent.click(screen.getByLabelText('Автоматически отправить акт на email участникам (От кого / На кого)'));



    expect(onFieldChange).toHaveBeenCalledWith('from_employee', 'Сидоров С.С.');

    expect(onInvNosChange).toHaveBeenCalledTimes(1);

    expect(onAutoEmailChange).toHaveBeenCalledWith(false);

  });

});

