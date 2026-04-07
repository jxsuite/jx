/**
 * server.js — JSONsx development server
 *
 * Run with: bun run dev
 */

import { resolve } from 'node:path';
import { createDevServer } from '@jsonsx/server';

await createDevServer({
  root: resolve(import.meta.dir, '.'),
  port: 3000,
  builds: [
    {
      entrypoints: ['./packages/runtime/runtime.js'],
      outdir: './dist',
      match: /runtime|effect\.js/,
      label: 'runtime',
    },
    {
      entrypoints: ['./packages/studio/studio.js'],
      outdir: './dist/studio',
      match: /studio/,
      label: 'studio',
    },
  ],
});

console.log('  /studio/              ← JSONsx Studio');
console.log('  /examples/todo/');
console.log('  /examples/counter/');
console.log('  /examples/computed/');
console.log('  /examples/list/');
console.log('  /examples/fetch/');
console.log('  /examples/form/');
console.log('  /examples/switch/');
