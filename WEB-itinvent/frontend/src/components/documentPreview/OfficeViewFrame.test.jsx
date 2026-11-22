import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OfficeViewFrame from './OfficeViewFrame';

const docsApiMocks = vi.hoisted(() => ({
  editorEvents: null,
  destroyed: 0,
}));

vi.mock('../myFiles/useMyFilesEditorSession', () => ({
  loadDocsApi: vi.fn(async () => {
    window.DocsAPI = {
      DocEditor: function DocEditor(_id, options) {
        docsApiMocks.editorEvents = options?.events || {};
        this.destroyEditor = () => {
          docsApiMocks.destroyed += 1;
        };
      },
    };
  }),
}));

const theme = createTheme();

const renderFrame = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <OfficeViewFrame
      config={{ document: { key: 'view-1' } }}
      publicPath="/onlyoffice"
      onError={vi.fn()}
      {...props}
    />
  </ThemeProvider>,
);

describe('OfficeViewFrame', () => {
  afterEach(() => {
    docsApiMocks.editorEvents = null;
    docsApiMocks.destroyed = 0;
    vi.useRealTimers();
    delete window.DocsAPI;
  });

  it('reports a fatal error when the SDK never fires document events', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    renderFrame({ onError });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(docsApiMocks.editorEvents.onDocumentReady).toBeTypeOf('function');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/не ответил вовремя/i)).toBeTruthy();
  });

  it('stays quiet past the timeout once the document is ready', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    renderFrame({ onError });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      docsApiMocks.editorEvents.onDocumentReady();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it('forwards SDK errors to the fallback handler once', async () => {
    const onError = vi.fn();
    renderFrame({ onError });

    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      docsApiMocks.editorEvents.onError();
      docsApiMocks.editorEvents.onError();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Не удалось открыть документ/i)).toBeTruthy();
  });
});
