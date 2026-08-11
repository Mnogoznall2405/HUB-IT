import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EmployeeDirectoryPanel from './EmployeeDirectoryPanel';

const people = [
  {
    full_name: 'Антоненко Оксана Валерьевна',
    position: 'Ведущий специалист',
    department: 'Отдел комплектации оборудованием',
    department_location: 'г. Санкт-Петербург',
    work_phones: ['83452384193'],
    work_emails: ['antonenko.ov@zsgp.ru'],
  },
  {
    full_name: 'Пызина Анна Александровна',
    position: 'Главный специалист',
    department: 'Отдел комплектации оборудованием',
    department_location: 'г. Санкт-Петербург',
    work_phones: [],
    work_emails: [],
  },
  {
    full_name: 'Клочковский Игорь Александрович',
    position: 'Начальник',
    department: 'Отдел комплектации оборудованием',
    department_location: 'Москва',
    work_phones: [],
    work_emails: [],
  },
];

describe('EmployeeDirectoryPanel', () => {
  it('groups compact employee cards by city in responsive grids', () => {
    render(<EmployeeDirectoryPanel people={people} loading={false} focusedPerson={null} />);

    expect(screen.getByText('3 человек')).toBeInTheDocument();
    expect(screen.getAllByTestId('employee-grid')).toHaveLength(2);
    expect(screen.getAllByTestId('employee-card')).toHaveLength(3);

    const citySection = screen.getByText('г. Санкт-Петербург').closest('section');
    expect(citySection).not.toBeNull();
    expect(citySection).toHaveAttribute('data-surface', 'employee-section');
    expect(within(citySection).getByText('2')).toBeInTheDocument();
    expect(within(citySection).getByText('Антоненко Оксана Валерьевна')).toBeInTheDocument();
    expect(within(citySection).getByText('Пызина Анна Александровна')).toBeInTheDocument();
    within(citySection).getAllByTestId('employee-card').forEach((card) => {
      expect(card).toHaveAttribute('data-surface', 'employee-card');
    });
  });

  it('highlights a listed search result without duplicating its card', () => {
    render(<EmployeeDirectoryPanel people={people} loading={false} focusedPerson={people[0]} />);

    expect(screen.getAllByText('Антоненко Оксана Валерьевна')).toHaveLength(1);
    expect(screen.queryByText('Найденный сотрудник')).not.toBeInTheDocument();
  });

  it('places the department head first and deputies immediately after', () => {
    const leadershipPeople = [
      {
        full_name: 'Специалистов Сергей Сергеевич',
        position: 'Главный специалист',
        department: 'Управление энергетики',
        department_location: 'Тюмень',
      },
      {
        full_name: 'Заместителев Пётр Петрович',
        position: 'Заместитель начальника управления',
        department: 'Управление энергетики',
        department_location: 'Москва',
      },
      {
        full_name: 'Начальников Иван Иванович',
        position: 'Начальник управления',
        department: 'Управление энергетики',
        department_location: 'Москва',
      },
    ];

    render(<EmployeeDirectoryPanel people={leadershipPeople} loading={false} focusedPerson={null} />);

    const cards = screen.getAllByTestId('employee-card');
    expect(cards[0]).toHaveAttribute('data-leadership-role', 'head');
    expect(within(cards[0]).getByText('Начальник подразделения')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Начальников Иван Иванович')).toBeInTheDocument();
    expect(cards[1]).toHaveAttribute('data-leadership-role', 'deputy');
    expect(within(cards[1]).getByText('Заместитель начальника')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Заместителев Пётр Петрович')).toBeInTheDocument();
    expect(cards[2]).toHaveAttribute('data-leadership-role', 'staff');
  });
});
