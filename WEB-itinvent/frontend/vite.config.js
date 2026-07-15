import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync, createReadStream, statSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PDFJS_ASSET_DIRECTORIES = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

const pdfjsStaticAssets = (currentDir) => {
  const packageRoot = resolve(currentDir, 'node_modules', 'pdfjs-dist');
  const contentTypes = {
    '.bcmap': 'application/octet-stream',
    '.icc': 'application/vnd.iccprofile',
    '.pfb': 'application/octet-stream',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
  };

  return {
    name: 'itinvent-pdfjs-static-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
        if (!pathname.startsWith('/pdfjs/')) return next();
        const relativePath = pathname.slice('/pdfjs/'.length);
        const directory = relativePath.split('/')[0];
        if (!PDFJS_ASSET_DIRECTORIES.includes(directory)) return next();
        const filePath = resolve(packageRoot, relativePath);
        if (!filePath.startsWith(`${packageRoot}${sep}`)) return next();
        try {
          if (!statSync(filePath).isFile()) return next();
        } catch {
          return next();
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream');
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(filePath).pipe(response);
        return undefined;
      });
    },
    writeBundle(outputOptions) {
      const outputDir = outputOptions.dir;
      if (!outputDir) return;
      PDFJS_ASSET_DIRECTORIES.forEach((directory) => {
        cpSync(
          resolve(packageRoot, directory),
          resolve(outputDir, 'pdfjs', directory),
          { recursive: true, force: true },
        );
      });
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const envDir = resolve(currentDir, '..', '..');
  const env = loadEnv(mode, envDir, '');
  const backendHost = env.VITE_BACKEND_HOST || 'localhost';
  const backendPort = env.VITE_BACKEND_PORT || '8001';
  const backendTarget = `http://${backendHost}:${backendPort}`;
  const scanBackendTarget = env.VITE_SCAN_BACKEND_TARGET || 'http://localhost:8011';
  // In production default to absolute root paths to avoid /route/assets/* requests on refresh.
  // If app is deployed to a virtual directory, override with VITE_BASE_PATH (example: /itinvent/).
  const normalizeBasePath = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '/';
    if (raw === '.' || raw === './') return '/';
    const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
    return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
  };
  const basePath = mode === 'development' ? '/' : normalizeBasePath(env.VITE_BASE_PATH || '/');

  return {
    envDir,
    base: basePath,
    plugins: [react(), tailwindcss(), pdfjsStaticAssets(currentDir)],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      css: true,
      testTimeout: 15_000,
    },
    server: {
      port: 5173,
      proxy: {
        '/api/v1/scan': {
          target: scanBackendTarget,
          changeOrigin: true,
        },
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        }
      }
    },
    optimizeDeps: {
      include: ['react', 'react-dom', '@emotion/react', '@emotion/styled'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/recharts')) {
              return 'recharts';
            }
            if (id.includes('node_modules/emoji-picker-react')) {
              return 'emoji-picker';
            }
            if (id.includes('/pages/chat/ChatPageContent')) {
              return 'chat-page-content';
            }
            if (id.includes('/components/chat/ChatDialogs')) {
              return 'chat-dialogs';
            }
            return undefined;
          },
        },
      },
    },
  };
});
