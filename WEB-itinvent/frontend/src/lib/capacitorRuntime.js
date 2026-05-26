import { isNativeShellRuntime } from './platform';

const getCapacitorGlobal = () => {
  if (!isNativeShellRuntime() || typeof window === 'undefined') {
    return null;
  }
  return window.Capacitor || null;
};

export const getCapacitorPlugin = (pluginName) => {
  const capacitor = getCapacitorGlobal();
  if (!capacitor) {
    return null;
  }
  return capacitor.Plugins?.[pluginName] || capacitor.plugins?.[pluginName] || null;
};

export const invokeCapacitorPlugin = (plugin, methodName, payload) => {
  const method = plugin?.[methodName];
  if (typeof method !== 'function') {
    return;
  }
  Promise.resolve(method.call(plugin, payload)).catch((error) => {
    console.warn(`Capacitor ${methodName} failed`, error);
  });
};

export const removeCapacitorListener = (listener) => {
  if (!listener) {
    return;
  }
  if (typeof listener.remove === 'function') {
    listener.remove();
    return;
  }
  if (typeof listener.then === 'function') {
    listener
      .then((handle) => {
        if (typeof handle?.remove === 'function') {
          handle.remove();
        }
      })
      .catch(() => {});
  }
};

export const configureCapacitorStatusBar = () => {
  const statusBar = getCapacitorPlugin('StatusBar');
  if (!statusBar) {
    return;
  }
  invokeCapacitorPlugin(statusBar, 'setOverlaysWebView', { overlay: false });
  invokeCapacitorPlugin(statusBar, 'setBackgroundColor', { color: '#0f1722' });
};
