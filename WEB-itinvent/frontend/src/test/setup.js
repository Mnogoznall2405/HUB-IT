import { afterEach } from 'vitest';

const createMemoryStorage = () => {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => (values.has(String(key)) ? values.get(String(key)) : null),
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(String(key));
    },
    clear: () => {
      values.clear();
    },
  };
};

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');

  // Node 24+ exposes its own `localStorage` global that is undefined without
  // --localstorage-file and shadows the jsdom Storage implementation.
  for (const name of ['localStorage', 'sessionStorage']) {
    if (!window[name]) {
      Object.defineProperty(window, name, { configurable: true, value: createMemoryStorage() });
    }
    if (typeof globalThis !== 'undefined' && !globalThis[name]) {
      Object.defineProperty(globalThis, name, { configurable: true, value: window[name] });
    }
  }

  afterEach(() => {
    cleanup();
  });

  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
}
