---
spec: studio.md
level: patch
---

§17.1: the settings dialog and its editor are built once per session and kept closed between opens; a reopen redraws the current section in the same frame, into a fresh section container so no form state or save error survives a close.
