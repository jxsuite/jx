---
spec: studio.md
level: minor
---

§11.1: release bundles and the Monaco workers are minified with linked source maps; the dev watcher is not, and a survey of the unminified bundle, not the keepNames flag Bun 1.4.2 ignores, is what makes renaming safe. The worker maps, like the chunks', stay out of the npm tarball: package.json publishes dist/workers/*.js, and check-studio-package.ts fails a files entry that would publish a dist/ source map.
