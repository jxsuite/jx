---
spec: studio.md
level: minor
---

StudioPlatform gains the optional subscribeProjectState member (§3.4); while it is live, Studio recognises its own writes by hash instead of the 1.5 second window and reloads open tabs from the subscription's fileChanged events (§9.2).
