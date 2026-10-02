import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// R48: Apple emoji images are served by us, never by an external CDN. The PNGs live in the
// emoji-datasource-apple package (same data generation as emoji-picker-react); like the pdf.js
// assets they are served straight from node_modules in dev and copied into the build output.
export const EMOJI_APPLE_URL_PREFIX = '/emoji/apple/64/';

export const emojiAppleAssets = (currentDir) => {
  const imageRoot = resolve(currentDir, 'node_modules', 'emoji-datasource-apple', 'img', 'apple', '64');
  return {
    name: 'hubit-emoji-apple-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(String(request.url || '/').split('?')[0]);
        if (!pathname.startsWith(EMOJI_APPLE_URL_PREFIX)) return next();
        const fileName = pathname.slice(EMOJI_APPLE_URL_PREFIX.length);
        if (!/^[0-9a-f-]+\.png$/.test(fileName)) return next();
        const filePath = resolve(imageRoot, fileName);
        if (!filePath.startsWith(`${imageRoot}${sep}`)) return next();
        try {
          if (!statSync(filePath).isFile()) return next();
        } catch {
          return next();
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(filePath).pipe(response);
        return undefined;
      });
    },
    writeBundle(outputOptions) {
      const outputDir = outputOptions.dir;
      if (!outputDir) return;
      if (!existsSync(imageRoot)) {
        throw new Error(`emoji-datasource-apple images were not found: ${imageRoot} (run npm install)`);
      }
      cpSync(imageRoot, resolve(outputDir, 'emoji', 'apple', '64'), {
        recursive: true,
        force: true,
        filter: (source) => !statSync(source).isFile() || source.endsWith('.png'),
      });
    },
  };
};
