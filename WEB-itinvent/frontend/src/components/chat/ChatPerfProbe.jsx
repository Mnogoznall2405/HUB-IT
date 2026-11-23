import { Profiler } from 'react';

// Инструментальный Profiler: активен только когда тест выставил
// window.__perf до загрузки React. В проде без __perf — прозрачный
// фрагмент, ноль накладных расходов.
const onRender = (id, phase, actualDuration, baseDuration) => {
  const p = window.__perf.profiles[id] || (window.__perf.profiles[id] = { mount: 0, update: 0, actual: 0, base: 0 });
  p[phase === 'mount' ? 'mount' : 'update'] += 1;
  p.actual += actualDuration;
  p.base += baseDuration;
};

export const ChatPerfProbe = ({ id, children }) => {
  if (typeof window === 'undefined' || !window.__perf) return children;
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
};
