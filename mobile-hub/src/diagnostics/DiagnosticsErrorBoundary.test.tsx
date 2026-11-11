import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { componentFrames, DiagnosticsErrorBoundary, renderFailureLocation } from './DiagnosticsErrorBoundary';
import { recordDiagnosticEvent } from './diagnostics';

let mockSegments: string[] = [];
jest.mock('expo-router', () => ({ useSegments: () => mockSegments }));
jest.mock('../components/ui/HubButton', () => ({ HubButton: () => null }));
jest.mock('./diagnostics', () => ({
  recordDiagnosticEvent: jest.fn(async () => undefined),
  recordReleaseHealthMetric: jest.fn(async () => undefined),
}));

function Boom(): never {
  throw new TypeError('secret user text must not be stored');
}

describe('render failure diagnostics', () => {
  beforeEach(() => {
    jest.mocked(recordDiagnosticEvent).mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('names only the route template, never ids', () => {
    expect(renderFailureLocation(['(shell)', 'chat', '[conversationId]'])).toEqual({ scope: 'chat', stage: 'render-thread' });
    expect(renderFailureLocation(['chat', 'index'])).toEqual({ scope: 'chat', stage: 'render-index' });
    expect(renderFailureLocation([])).toEqual({ scope: 'other', stage: 'render-root' });
  });

  it('keeps only component names from the component stack', () => {
    const stack = ['', '    at ChatComposer (index.android.bundle:1:20)', '    in KeyboardStickyView', '    at div', '    at NativeChatThreadScreen (x)'].join(String.fromCharCode(10));
    expect(componentFrames(stack))
      .toEqual(['at ChatComposer (<source>:0:0)', 'at KeyboardStickyView (<source>:0:0)', 'at NativeChatThreadScreen (<source>:0:0)']);
    expect(componentFrames(undefined)).toEqual([]);
  });

  it('records the screen and error type of a render failure without its message', async () => {
    mockSegments = ['chat', '[conversationId]'];
    const view = await render(<DiagnosticsErrorBoundary><Boom /></DiagnosticsErrorBoundary>);
    expect(view.getByText('Не удалось отобразить экран')).toBeTruthy();
    expect(recordDiagnosticEvent).toHaveBeenCalledTimes(1);
    const [code, snapshot] = jest.mocked(recordDiagnosticEvent).mock.calls[0];
    expect(code).toBe('ui_render_error');
    expect(snapshot).toMatchObject({ scope: 'chat', stage: 'render-thread', errorType: 'TypeError' });
    expect(JSON.stringify(snapshot)).not.toContain('secret user text');
    expect((snapshot as { stack: string }).stack).toContain('at Boom (<source>:0:0)');
  });

  it('renders children when nothing fails', async () => {
    mockSegments = [];
    const view = await render(<DiagnosticsErrorBoundary><Text>ok</Text></DiagnosticsErrorBoundary>);
    expect(view.getByText('ok')).toBeTruthy();
  });
});
