import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

function Editor({ id }) {
  const guard = useConstructionWorkLeaveGuard(true);
  return guard.pending
    ? <div role="dialog" data-testid={`dialog-${id}`}><button onClick={guard.cancel}>Остаться</button></div>
    : null;
}

function TwoEditorsScene() {
  const [showA, setShowA] = useState(true);
  const location = useLocation();
  return <>
    <div data-testid="path">{location.pathname}</div>
    {showA ? <Editor id="a" /> : null}
    <Editor id="b" />
    <button onClick={() => setShowA(false)}>Закрыть A</button>
    <Link to="/away">Уйти</Link>
  </>;
}

it('two mounted dirty guards share one navigator patch and the survivor keeps blocking', () => {
  render(<MemoryRouter initialEntries={['/direction']}><TwoEditorsScene /></MemoryRouter>);

  fireEvent.click(screen.getByText('Уйти'));
  // The last-subscribed guard (the innermost editor) answers first.
  expect(screen.getByTestId('dialog-b')).toBeInTheDocument();
  expect(screen.queryByTestId('dialog-a')).toBeNull();
  fireEvent.click(within(screen.getByTestId('dialog-b')).getByText('Остаться'));
  expect(screen.getByTestId('path')).toHaveTextContent('/direction');

  // Unmounting the first guard must not restore navigator methods while the
  // second guard is still subscribed — otherwise its protection dies silently.
  fireEvent.click(screen.getByText('Закрыть A'));
  fireEvent.click(screen.getByText('Уйти'));
  expect(screen.getByTestId('dialog-b')).toBeInTheDocument();
  expect(screen.getByTestId('path')).toHaveTextContent('/direction');
});
