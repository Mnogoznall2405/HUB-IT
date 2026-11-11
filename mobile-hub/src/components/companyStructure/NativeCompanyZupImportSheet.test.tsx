import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as companyApi from '../../api/companyStructureApi';
import type { CompanyStructureNode } from '../../api/companyStructureApi';
import { getFluentTokens } from '../../theme/fluentTokens';
import { NativeCompanyZupImportSheet } from './NativeCompanyZupImportSheet';

jest.mock('../../api/companyStructureApi', () => ({
  searchCompanyStructureDepartmentNames: jest.fn(),
}));

const parent: CompanyStructureNode = {
  id: 'block-1',
  parent_id: 'root',
  node_type: 'block',
  title: 'ИТ-блок',
  person_name: '',
  person_position: '',
  person_employee_code: null,
  person_photo_url: null,
  direct_people_count: 0,
  subtree_people_count: 0,
  child_node_count: 0,
  sort_order: 0,
  is_active: true,
  department_codes: [],
  children: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (companyApi.searchCompanyStructureDepartmentNames as jest.Mock).mockResolvedValue({
    items: [{
      department: 'Поддержка объект',
      department_base: 'Поддержка',
      department_location: 'Екатеринбург',
      department_locations: ['Екатеринбург'],
      people_count: 7,
      department_codes: ['001'],
      binding_group: 'object',
    }, {
      department: 'Смешанная служба',
      department_base: 'Смешанная служба',
      department_location: 'Москва, объект',
      department_locations: ['Москва', 'объект'],
      people_count: 4,
      department_codes: ['002'],
      binding_group: 'mixed',
    }],
    total: 2,
    limit: 500,
  });
});

it('collects exact ZUP cards locally and only requests confirmation after a button press', async () => {
  const confirm = jest.fn();
  const view = await render(
    <NativeCompanyZupImportSheet
      visible
      parent={parent}
      importing={false}
      mutationError=""
      tokens={getFluentTokens('light')}
      onClose={jest.fn()}
      onRequestConfirmation={confirm}
    />,
  );

  expect(confirm).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByLabelText('Поиск карточек подразделений ЗУП'), 'Под');
  await waitFor(() => expect(companyApi.searchCompanyStructureDepartmentNames).toHaveBeenCalledWith('Под', 500), { timeout: 1_500 });
  await waitFor(() => expect(view.getByLabelText('Поддержка объект')).toBeTruthy());
  expect(view.getByLabelText('Смешанная служба, смешанные площадки, недоступно').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Поддержка объект'));
  await waitFor(() => expect(view.getByLabelText('Убрать Поддержка объект')).toBeTruthy());
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('native-company-confirm-import'));
  expect(confirm).toHaveBeenCalledWith(['Поддержка объект']);
});
