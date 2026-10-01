---
spec: studio.md
level: minor
---

§11.1 and §11.2: the release build records the editor entry's static import closure as preload in dist/manifest.json, studioPreload() reads it back, and studioShellHtml({ preload }) emits opt-in modulepreload hints; the no-options document is unchanged. The dev server rewrites the manifest without preload at startup, so a watcher-rebuilt checkout yields no stale hints, and studioPreload drops entries that are not on disk.
