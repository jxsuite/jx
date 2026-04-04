/**
 * server.js — DDOM development server
 *
 * Bundles ddom.js for the browser, then serves everything statically.
 * Run with: bun run server.js
 */

// 1. Bundle the runtime (resolves node_modules → browser-safe ESM)
await Bun.build({
  entrypoints: ['./ddom.js'],
  outdir: './dist',
  target: 'browser',
  format: 'esm',
  sourcemap: 'linked',
});

console.log('Built → dist/ddom.js');

// 2. Serve everything as static files
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url  = new URL(req.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = Bun.file('.' + path);

    if (await file.exists()) return new Response(file);
    return new Response('Not found', { status: 404 });
  },
});

console.log(`http://localhost:${server.port}`);
console.log('Examples:');
console.log('  http://localhost:3000/                        (todo app)');
console.log('  http://localhost:3000/examples/counter/');
console.log('  http://localhost:3000/examples/computed/');
console.log('  http://localhost:3000/examples/list/');
console.log('  http://localhost:3000/examples/fetch/');
console.log('  http://localhost:3000/examples/form/');
console.log('  http://localhost:3000/examples/switch/');
