---
spec: desktop.md
level: minor
---

The packaged backend runs on Electron's Node as a utility process and carries no Bun; Studio installs packages with npm's installer, strictly; the cloud keeps package-lock.json in step through a lockfile-only package service
