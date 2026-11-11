// Test-only safety: preserve HTTPS/origin policy without contacting real servers.
const net = require('node:net');
const original = net.Socket.prototype.connect;
const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
net.Socket.prototype.connect = function (...args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  const options = first && typeof first === 'object' ? first : null;
  const host = String(options?.host || (typeof args[1] === 'string' ? args[1] : 'localhost')).toLowerCase();
  const localPipe = Boolean(options?.path && options.port == null && !options.host)
    || (typeof first === 'string' && !/^\d+$/.test(first));
  if (!localPipe && !loopback.has(host)) {
    throw Object.assign(new Error('Remote network access is disabled in HUB-IT tests'), {
      code: 'HUBIT_TEST_REMOTE_NETWORK_BLOCKED',
    });
  }
  return original.apply(this, args);
};
