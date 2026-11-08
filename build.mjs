import { build } from 'esbuild';

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
