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
      outdir: './packages/runtime/dist',
      match: /runtime\.js/,
      label: 'runtime',
    },
    {
      entrypoints: ['./packages/studio/studio.js'],
      outdir: './packages/studio/dist',
      match: /studio/,
      label: 'studio',
    },
  ],
});

console.log('  /packages/studio/              ← JSONsx Studio');
console.log('  /examples/todo/');
console.log('  /examples/counter/');
console.log('  /examples/computed/');
console.log('  /examples/list/');
console.log('  /examples/fetch/');
console.log('  /examples/form/');
console.log('  /examples/switch/');
