---
spec: desktop.md
level: minor
---

The window's session runs the project state host and answers projectSubscribe, projectWrite and projectDelete over its socket, refusing the unconditional writes to a socket that subscribed (§7.3); the adapter exposes the subscription as projectState and reports a reconnect as its end (§10.1).
