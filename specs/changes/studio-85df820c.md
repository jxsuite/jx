---
spec: studio.md
level: patch
---

The Content home's Duplicate is the Media workspace's byte-exact copy, so it keeps non-UTF-8 bytes and never overwrites, and writes valid UTF-8 as a document so a backend that files uploads as binaries can still open the copy; a folder that cannot be listed makes no copy, a backend without readFileBytes is not offered it, and an upload's collision-free name no longer depends on case (§9.3).
