---
spec: studio.md
level: minor
---

§3.4 a listing entry may carry an opaque content version; repo-space media a listing vouched for is requested with a `?v=` query naming that version, the version map is forgotten on every file event before the echo filter and on Studio's own mutations, a listing begun before a forget cannot restore it, a gap in the event stream (a reconnect, or the stream's first open) forgets every version at once and ignores listings begun before it, an authored v (matched by its decoded name) is replaced when Studio appends a version and left untouched otherwise, a host may answer a versioned URL immutably only when v is a version it issued and it returns exactly the bytes that version names, the Library's document previews use the map too, and the canvas iframe receives the media versions as one assetVersions message rather than on every render. §9.2 a new "open" resync reason forgets the content versions and re-lists the loaded tree.
