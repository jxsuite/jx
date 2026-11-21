---
spec: desktop.md
level: minor
---

§10.1 the desktop and dev-server adapters report their first open as "open"; the desktop watcher reports a write once it is whole, exposes its initial scan as ready, keeps one watcher per root across a re-root onto the same folder, and pushes onFileResync "open" each time it is ready; a batch reaching no subscriber becomes one "open" for the next.
