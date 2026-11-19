import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CompanyStructureFocus from './CompanyStructureFocus';

describe('CompanyStructureFocus alignment', () => {
  it('centres an incomplete row of semantic peers', () => {
    const root = {
      id: 'root',
      node_type: 'root',
      title: 'Генеральный директор',
      children: [
        { id: 'build', node_type: 'block', title: 'Строительный блок с очень длинным названием', children: [] },
        { id: 'admin', node_type: 'block', title: 'Административный блок', children: [] },
      ],
    };

    render(
      <CompanyStructureFocus
        tree={[root]}
        selectedNode={root}
        selectedPath={[root]}
        onSelect={vi.fn()}
        onPeople={vi.fn()}
      />,
    );

    const level = screen.getByTestId('focus-level-1');
    expect(level).toHaveStyle({ display: 'flex', justifyContent: 'center' });
    expect(level).toHaveStyle({ flexWrap: 'wrap' });
    const peerCards = screen.getAllByTestId('focus-node-card')
      .filter((card) => card.dataset.selected === 'false');
    expect(peerCards).toHaveLength(2);
    peerCards.forEach((card) => expect(card).toHaveStyle({ minHeight: '136px' }));
  });

  it('lets a leader card grow past the baseline instead of clipping name and position', () => {
    const root = {
      id: 'root',
      node_type: 'root',
      title: 'Генеральный директор по направлению и развитию',
      person_name: 'Иванов Иван Иванович',
      person_position: 'Первый заместитель генерального директора',
      person_employee_code: 'EMP-1',
      children: [],
    };

    render(
      <CompanyStructureFocus
        tree={[root]}
        selectedNode={root}
        selectedPath={[root]}
        onSelect={vi.fn()}
        onPeople={vi.fn()}
      />,
    );

    const card = screen.getByTestId('focus-node-card');
    expect(card).toHaveStyle({ minHeight: '156px' });
    const button = card.querySelector('button');
    expect(button).toHaveStyle({ flex: '1 1 0%', minHeight: '112px' });
    expect(button).not.toHaveStyle({ overflow: 'hidden' });
    expect(screen.getByText('Иванов Иван Иванович')).toBeInTheDocument();
    expect(screen.getByText('Первый заместитель генерального директора')).toBeInTheDocument();
  });

  it('shows employees inline for a terminal node', () => {
    const department = {
      id: 'department',
      node_type: 'department',
      title: 'Отдел расчётов',
      children: [],
    };

    render(
      <CompanyStructureFocus
        tree={[department]}
        selectedNode={department}
        selectedPath={[department]}
        people={[{
          full_name: 'Иванов Иван Иванович',
          position: 'Специалист',
          department: 'Отдел расчётов',
          department_location: 'Тюмень',
          work_phones: ['+7 3452 00-00-00'],
          work_emails: ['ivanov@example.test'],
        }]}
        peopleLoading={false}
        focusedPerson={null}
        onSelect={vi.fn()}
        onPeople={vi.fn()}
      />,
    );

    expect(screen.getByText('Сотрудники')).toBeInTheDocument();
    expect(screen.getByText('Иванов Иван Иванович')).toBeInTheDocument();
    expect(screen.getByText('+7 3452 00-00-00')).toBeInTheDocument();
    expect(screen.queryByText('У подразделения нет дочерних карточек.')).not.toBeInTheDocument();
  });
});
