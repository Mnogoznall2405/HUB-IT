import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync, createReadStream, statSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDefaults } from 'vitest/config'
import { canonicalWebConfig } from './scripts/canonical-web-config.mjs'
import { emojiAppleAssets } from './scripts/emoji-apple-assets-plugin.mjs'
import { stampedServiceWorker } from './scripts/stamped-service-worker-plugin.mjs'

const NODE_TEST_FILES = [
  'scripts/assetlinks-web-config.test.js',
  'scripts/canonical-web-config.test.js',
  'scripts/stamp-service-worker.test.js',
  'scripts/vite-stamp-plugin.test.js',
  'src/api/mailMailboxQuery.test.js',
  'src/components/addressBook/addressBookUtils.test.js',
  'src/components/chat/chatScheduledTime.test.js',
  'src/components/chat/sandboxPermissionCard.test.js',
  'src/components/feed/feedUtils.test.js',
  'src/components/hub/taskWorkspaceActions.test.js',
  'src/components/mail/mailAccessState.test.js',
  'src/components/mail/mailAttachmentLayout.test.js',
  'src/components/mail/mailComposeSubject.test.js',
  'src/components/mail/mailDateGrouping.test.js',
  'src/components/mail/mailFolderRailUtilityItems.test.js',
  'src/components/mail/mailFolderTreeModel.test.js',
  'src/components/mail/mailListFilterActivity.test.js',
  'src/components/mail/mailListSelection.test.js',
  'src/components/mail/mailMobileHistory.test.js',
  'src/components/mail/mailMoveTargets.test.js',
  'src/components/mail/mailMoveUndo.test.js',
  'src/components/mail/mailPeople.test.js',
  'src/components/mail/mailPlural.test.js',
  'src/components/mail/mailSendIdempotency.test.js',
  'src/components/mail/mailTemplateModel.test.js',
  'src/components/mail/mailTrashUndo.test.js',
  'src/components/passwords/adOuTreeUtils.test.js',
  'src/data/russianCities.test.js',
  'src/indexHtml.test.js',
  'src/lib/aiReplyPreview.test.js',
  'src/lib/appBranding.test.js',
  'src/lib/appPushPermissions.test.js',
  'src/lib/chat/chatThreadScrollModel.test.js',
  'src/lib/chat/emojiImages.test.js',
  'src/lib/desktopQuickRoutes.test.js',
  'src/lib/desktopShellStatus.test.js',
  'src/lib/documentPreviewKind.test.js',
  'src/lib/groupsAccessUtils.test.js',
  'src/lib/hubCommands.test.js',
  'src/lib/hubTaskIntegrations.test.js',
  'src/lib/mobileNavigationPreferences.test.js',
  'src/lib/myFilesFolderZip.test.js',
  'src/lib/ruPlural.test.js',
  'src/lib/scanIncidentInbox.test.js',
  'src/lib/swrCache.test.js',
  'src/lib/systemNotificationEnvelope.test.js',
  'src/lib/taskNavigation.test.js',
  'src/lib/vncEndpoint.test.js',
  'src/pages/account/accountUserModel.test.js',
  'src/pages/chat/buildChatPageDialogsLayerProps.test.js',
  'src/pages/chat/buildChatPagePanesBags.test.js',
  'src/pages/chat/chatActiveConversationModel.test.js',
  'src/pages/chat/chatConversationModel.test.js',
  'src/pages/chat/chatKeyedInFlight.test.js',
  'src/pages/chat/chatMobileModel.test.js',
  'src/pages/chat/chatOptimisticMessages.test.js',
  'src/pages/chat/chatThreadHistory.test.js',
  'src/pages/chat/chatThreadMessageMerge.test.js',
  'src/pages/chat/chatThreadMessages.test.js',
  'src/pages/chat/chatThreadTransport.test.js',
  'src/pages/chat/pickChatPageLayoutSections.test.js',
  'src/pages/company-structure/companyStructureLayout.test.js',
  'src/pages/company-structure/companyStructureModel.test.js',
  'src/pages/database/databaseRecordModel.test.js',
  'src/pages/database/databaseReturnContext.test.js',
  'src/pages/tasksViewModel.test.js',
  'src/pages/tasks/TasksDialogsLayer.test.jsx',
  'src/pages/tasks/taskAnalyticsModel.test.js',
  'src/pages/tasks/taskAnalyticsViewModel.test.js',
  'src/pages/tasks/taskCardModel.test.js',
  'src/pages/tasks/taskChecklistUtils.test.js',
  'src/pages/tasks/taskCreateMobileSheet.test.js',
  'src/pages/tasks/taskEmailRemindUtils.test.js',
  'src/pages/tasks/taskFormatters.test.js',
  'src/pages/tasks/taskUserUtils.test.js',
  'src/pages/tasks/tasksMobileCopy.test.js',
  'src/pages/voice-video/labelingModel.test.js',
  'src/pages/voice-video/mediaParts.test.js',
  'src/pages/voice-video/meetingTitle.test.js',
];

const TEST_PROJECTS = [
  {
    extends: true,
    test: {
      name: 'unit-node',
      environment: 'node',
      include: NODE_TEST_FILES,
    },
  },
  {
    extends: true,
    test: {
      name: 'ui-dom',
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, ...NODE_TEST_FILES],
    },
  },
];

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
  const voiceBackendTarget = env.VITE_VOICE_BACKEND_TARGET || 'http://localhost:8013';
  const canonicalHost = env.VITE_CANONICAL_HOST || undefined;
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
    plugins: [
      react(),
      tailwindcss(),
      pdfjsStaticAssets(currentDir),
      emojiAppleAssets(currentDir),
      canonicalWebConfig(currentDir, canonicalHost),
      stampedServiceWorker(),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      css: true,
      testTimeout: 15_000,
      projects: TEST_PROJECTS,
    },
    server: {
      port: 5173,
      proxy: {
        '/api/v1/voice': {
          target: voiceBackendTarget,
          changeOrigin: true,
        },
        '/api/v1/scan': {
          target: scanBackendTarget,
          changeOrigin: true,
        },
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          // Chat realtime (/api/v1/chat/ws) needs the WS upgrade proxied too;
          // without it the socket hangs in CONNECTING and chat falls back to polling.
          ws: true,
        }
      }
    },
    optimizeDeps: {
      include: ['react', 'react-dom', '@emotion/react', '@emotion/styled'],
    },
    build: {
      manifest: true,
    },
  };
});
