import { build } from 'esbuild';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { buildAvatars } from './scripts/build-avatars.mjs';

await buildAvatars();

await mkdir('public/icons', { recursive: true });
await Promise.all([180, 192, 512].map((size) => sharp('public/icon.svg').resize(size, size).png().toFile(`public/icons/icon-${size}.png`)));

await build({
  entryPoints: ['public/cloud.js'],
  outfile: 'public/cloud.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
});
