import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it } from 'vitest';
import { useConstructionWorkLeaveGuard } from './useConstructionWorkLeaveGuard';

function Journal() {
  const [dirty, setDirty] = useState(false);
  const guard = useConstructionWorkLeaveGuard(dirty);
  const location = useLocation();
  return <>
    <div data-testid="path">{location.pathname}</div>
    <button onClick={() => setDirty(true)}>Изменить</button>
    <Link to="/direction/requests/one">Заявка</Link>
    <Link to="/other">Другой объект</Link>
    {guard.pending ? <div role="dialog"><button onClick={() => { setDirty(false); guard.leave(); }}>Уйти</button><button onClick={guard.cancel}>Остаться</button></div> : null}
  </>;
}

it('a confirmed transition within the mounted workspace does not disable future guards', () => {
  render(<MemoryRouter initialEntries={['/direction']}><Journal /></MemoryRouter>);
  fireEvent.click(screen.getByText('Изменить'));
  fireEvent.click(screen.getByText('Заявка'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Уйти'));
  expect(screen.getByTestId('path')).toHaveTextContent('/direction/requests/one');
  fireEvent.click(screen.getByText('Изменить'));
  fireEvent.click(screen.getByText('Другой объект'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Остаться'));
  expect(screen.getByTestId('path')).toHaveTextContent('/direction/requests/one');
});
