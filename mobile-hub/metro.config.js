const { getDefaultConfig } = require('expo/metro-config');
const https = require('https');
const { URL } = require('url');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const API_ORIGIN = (process.env.EXPO_PUBLIC_API_PROXY_TARGET || 'https://hubit.zsgp.ru').replace(
  /\/$/,
  '',
);

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      const rawUrl = req.url || '';
      if (!rawUrl.startsWith('/api/')) {
        return middleware(req, res, next);
      }

      let target;
      try {
        target = new URL(rawUrl, `${API_ORIGIN}/`);
      } catch {
        res.statusCode = 502;
        res.end('Bad proxy URL');
        return;
      }

      const headers = { ...req.headers, host: target.host };
      delete headers.connection;

      const proxyReq = https.request(
        {
          method: req.method,
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          headers,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: `Proxy: ${err.message}` }));
        }
      });

      req.pipe(proxyReq);
    };
  },
};

module.exports = config;
