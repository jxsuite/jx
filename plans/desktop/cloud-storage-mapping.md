---
status: stub
disposition: reconcile
claims:
  - desktop.md#10.2
size: S
---

# §10.2 maps the filesystem onto the git-backed cloud backend that shipped

## Context

`specs/desktop.md` §10.2, line 998:

> **Status: Partial.** The mapping below is one possible one and not the one that shipped: the deployed backend is **git-backed**, a cloud project IS a repository, which is why `packages/studio/src/platforms/cloud.ts` sets `createDestination: "repo"` and carries the whole git family. What a backend MUST declare ships: `documentBaseUrl` and `assetSpace` in `cloud.ts`, `uploadFile` answering `UploadResult`, `assetCapabilities` read by `packages/studio/src/files/media-upload.ts`, and lossless `readFileBytes`.

The section was Partial before the census for the same reason; the census named the shipped members. Disposition `reconcile`: nothing is unbuilt. The body still says "The cloud backend stores projects in a database" over a table of project records and file rows, and the fix is to state the mapping that ships.

**What exists**

- `packages/studio/src/platforms/cloud.ts`: session-bound calls to `/api/v1/p/:owner/:repo/:branch/studio/*`, `createDestination: "repo"`, `openProjectPicker: "repo-list"`, the git family, `discoverComponents` as a tree walk, `readFileBytes` through `arrayBuffer()`, and `assetSpace: "repo"` with `documentBaseUrl` under `/raw/`.
- `packages/studio/src/files/media-upload.ts`, which reads `assetCapabilities` and the `UploadResult` path.
- `packages/studio/tests/cloud-platform.test.ts`.

**What is missing**

- The database table replaced by the git-backed mapping: `project.json` is the file at the repository root on the session's branch, a directory listing is that branch's tree, a write lands in the session's working tree and reaches the repository through the git family, and component discovery walks the tree.
- The opening sentence restated to match. The MUST-declare subsection stays as written.

**Related**

- desktop.md §10.1 (the adapter), desktop.md §3.1 (`documentBaseUrl`, `assetSpace`), desktop.md §4.5 (the `repo` destination).
- studio.md §9.3 (upload paths are the answer).
