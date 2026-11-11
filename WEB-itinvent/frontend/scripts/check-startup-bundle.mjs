#!/usr/bin/env node
/**
 * Production-dist checker for HUB login startup graph.
 * Fails on actual dist output, not vite.config.js source text.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(frontendRoot, process.env.HUB_DIST_DIR || 'dist');

const fail = (message) => {
  throw new Error(message);
};

const readText = (filePath) => readFileSync(filePath, 'utf8');

const listFiles = (dir, acc = []) => {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
};

const parseIndexHtml = (html) => {
  const moduleScripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/gi)]
    .map((m) => m[1]);
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gi)]
    .map((m) => m[1]);
  return { moduleScripts, preloads, styles };
};

const basenameOfHref = (href) => decodeURIComponent(String(href).split('/').pop() || '');

const loadAsset = (href) => {
  const fileName = basenameOfHref(href);
  const filePath = join(distRoot, 'assets', fileName);
  if (!existsSync(filePath)) {
    fail(`Missing dist asset referenced by index.html: ${href}`);
  }
  return { fileName, filePath, code: readText(filePath) };
};

export const checkStartupBundle = (root = distRoot) => {
  const htmlPath = join(root, 'index.html');
  if (!existsSync(htmlPath)) {
    fail(`dist/index.html not found at ${htmlPath}`);
  }
  const html = readText(htmlPath);
  const { moduleScripts, preloads, styles } = parseIndexHtml(html);
  const preloadNames = preloads.map(basenameOfHref).join(' ');
  if (/recharts/i.test(preloadNames)) {
    fail(`index.html modulepreload includes recharts: ${preloadNames}`);
  }
  if (/emoji-picker/i.test(preloadNames)) {
    fail(`index.html modulepreload includes emoji-picker: ${preloadNames}`);
  }

  const assets = listFiles(join(root, 'assets')).filter((p) => p.endsWith('.js'));
  const analytics = assets.filter((p) => /TasksAnalyticsCharts/i.test(p));
  if (analytics.length < 1) {
    fail('No lazy TasksAnalyticsCharts-*.js chunk in dist/assets');
  }
  const analyticsCode = analytics.map((p) => readText(p)).join('\n');
  if (!/recharts|AreaChart|ResponsiveContainer/.test(analyticsCode)) {
    fail('Tasks analytics chunk does not appear to contain recharts');
  }

  const emojiChunks = assets.filter((p) => /emoji-picker/i.test(p) || /ChatEmojiPanel/i.test(p));
  const emojiCode = emojiChunks.map((p) => readText(p)).join('\n');
  if (!/emoji-picker-react|EmojiPicker|lazy\(\(\)=>import\(/.test(emojiCode) && emojiChunks.length === 0) {
    fail('No lazy emoji-picker chunk found');
  }
  const hasEmojiModule = assets.some((p) => /emoji-picker/i.test(p));
  const hasEmojiContent = /emoji-picker-react|EmojiPicker/i.test(emojiCode);
  if (!hasEmojiModule && !hasEmojiContent) {
    fail('emoji-picker-react did not emit a lazy chunk');
  }

  if (moduleScripts.length < 1) {
    fail('index.html has no module script');
  }
  const entry = loadAsset(moduleScripts[0]);
  if (/recharts-legend-icon|recharts-responsive-container|from ["']recharts["']|node_modules\/recharts/.test(entry.code)) {
    fail('Login entry contains recharts modules');
  }
  if (/emoji-picker-react/.test(entry.code) && !/import\(["'][^"']*emoji-picker/.test(entry.code)) {
    fail('Login entry contains emoji-picker-react');
  }

  const manifestPath = join(root, '.vite', 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readText(manifestPath));
    const htmlEntry = manifest['index.html'];
    const dynamicImports = htmlEntry?.dynamicImports || [];
    const allManifest = JSON.stringify(manifest);
    if (!/TasksAnalyticsCharts/.test(allManifest)) {
      fail('Production manifest lost TasksAnalyticsCharts dynamic import');
    }
    if (!/emoji-picker/.test(allManifest)) {
      fail('Production manifest lost emoji-picker dynamic import');
    }
    if (!dynamicImports.some((item) => /Login/.test(String(item)))) {
      fail('Production build lost Login dynamic import');
    }
  }

  const allJs = assets.map((p) => readText(p)).join('\n');
  if (!allJs.includes('TasksAnalyticsCharts') && !analyticsCode) {
    fail('Tasks analytics dynamic import disappeared from the build');
  }

  const chatEmojiPanel = assets.find((p) => /ChatEmojiPanel/i.test(p));
  if (chatEmojiPanel) {
    const panel = readText(chatEmojiPanel);
    if (!/import\(/s.test(panel) && !/emoji-picker/.test(panel)) {
      fail('ChatEmojiPanel chunk lost its dynamic emoji import');
    }
  }

  if (styles.length < 1) {
    fail('index.html has no initial stylesheet');
  }

  return {
    ok: true,
    dist: root,
    entry: entry.fileName,
    preloads,
    analyticsChunks: analytics.map((p) => relative(root, p)),
    emojiChunks: assets.filter((p) => /emoji-picker/i.test(p)).map((p) => relative(root, p)),
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkStartupBundle();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
