---
spec: project-state.md
level: minor
---

The desktop backend hosts the project state service (§10.1): projectSubscribe, projectWrite and projectDelete over the window socket, one subscription per socket with a projectEnded push when the host ends it, a socket that falls too far behind included (§3.2), unconditional writes and deletes refused to a socket that subscribed (§5), the usage query answered from a settled, undegraded graph (§12), and the conformance case for an extension-registered format (§2.2); the live preview overlay is keyed by document and client and dropped with its file by path (§11.3), collaboration rooms are still open.
