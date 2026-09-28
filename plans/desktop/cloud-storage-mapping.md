---
status: drafted
disposition: reconcile
claims:
  - desktop.md#10.2
requires: []
workspaces:
  - packages/studio
size: S
---

# desktop.md §10.2 maps the filesystem onto the git-backed cloud backend that shipped

## Context

`specs/desktop.md` §10.2, line 998:

> **Status: Partial.** The mapping below is one possible one and not the one that shipped: the deployed backend is **git-backed**, a cloud project IS a repository, which is why `packages/studio/src/platforms/cloud.ts` sets `createDestination: "repo"` and carries the whole git family. What a backend MUST declare ships: `documentBaseUrl` and `assetSpace` in `cloud.ts`, `uploadFile` answering `UploadResult`, `assetCapabilities` read by `packages/studio/src/files/media-upload.ts`, and lossless `readFileBytes`.

The body under it still opens "The cloud backend stores projects in a database with an abstraction equivalent to the filesystem" over a four-row table (a project record with a config JSON column, a files table queried by parent path, row-level CRUD, discovery by naming convention). Nothing in the repository reads or builds that table. §10's own marker (line 982) says "The open part is §10.2's storage table, which sketches a database the git-backed backend was never built on." Disposition `reconcile`: nothing is unbuilt, the text is wrong.

Re-verified against the tree on 2026-09-27. What the adapter asks of the gateway, all in `createCloudPlatform` (`packages/studio/src/platforms/cloud.ts`), every call under `sessionBase(project)` = `/api/v1/p/:owner/:repo/:branch/studio`:

- **`project.json`.** `openProject`, `probeRootProject` and `resolveSiteContext` read `projectConfig` from `project-info` (`ProjectInfoWire`); `null` means the repository has no `project.json`, and `probeRootProject` reports `isSiteProject: false` (test `probeRootProject reports a non-jx repo as not a site project`).
- **Directories and files.** `listDirectory` → `GET files?dir=`; `readFile` → `GET file?path=`; `readFileBytes` → `GET file/bytes?path=` answered through `arrayBuffer()`; `writeFile` → `PUT file`; `uploadFile` → `POST file/upload?path=`, answering the body's `path` and falling back to the request's (`body.path ?? path`); `deleteFile` → `DELETE file?path=` (404 tolerated); `renameFile` → `POST file/rename`. `createDirectory` sends nothing: "Directories exist implicitly in the virtual tree (created on write)".
- **Commits.** The git family is the "virtual engine in the ProjectSession DO": `gitCommit` "Commits land on GitHub immediately (blobs → tree → commit → ref CAS)", and surfaces a moved branch as an error (test `gitCommit posts the message and surfaces conflict errors`, "Remote branch moved"); `gitPush` "Every commit is already on GitHub; push is a sync check"; `gitCheckout` navigates to the sibling branch's `editUrl`, because "Branches are separate cloud sessions".
- **Discovery.** `discoverComponents` walks the tree through `listDirectory` and `readFile` and answers `componentMetaFrom` per JSON file, skipping `node_modules`, `dist`, `build`, `.git`, `.claude`, `.obsidian` and every dot-directory, bounded at `MAX_DEPTH = 6` and `MAX_FILES = 400`. It never calls the protocol's `components` route (`packages/protocol/src/routes.ts`).
- **Serving.** A bound session declares `assetSpace: "repo"` and `documentBaseUrl: ${base}/raw/`, the protocol's `documentRaw` route; the project-less hub declares neither (tests under `describe("assetSpace")`).
- **Upload answer.** `uploadAssets` in `packages/studio/src/files/media-upload.ts` writes the path `uploadFile` reports (tests `a renaming store is honoured end to end`, `a backend that reports nothing keeps the requested path`) and reads `assetCapabilities`. The cloud adapter declares no `assetCapabilities`, which the MUST-declare list permits: absence means no declared limit.

The gateway itself (the session Durable Object, its row cache, its GitHub calls) is deployed from outside this repository; the adapter's comments are the only description of it here.

Two gaps the census did not name:

- `cloud.ts`'s module header (lines 9 to 11) lists "multi-window" and "component discovery" among the cloud omissions. §10.1 says `discoverComponents` is not omitted, and the adapter implements `openProjectInNewWindow` and `setWindowProject`; it omits only `newWindow` and `pickProject` of that family.
- Two facts the new table states have no adapter-level assertion: `createDirectory` sending nothing (the `bound session surface` test calls it and asserts nothing), and `uploadFile` answering a reported path that differs from the request (that test's gateway echoes the request). Nor does any test assert that discovery stays on `files` and `file`.

Related: desktop.md §10.1 (the adapter), desktop.md §3.1 (`documentBaseUrl`, `assetSpace`), desktop.md §4.5 (the `repo` destination), desktop.md §5.1 (gateway prefixes keep the sub-path), studio.md §9.3 (the upload path is the answer).

## Outcome

- desktop.md §10.2 → Implemented: the database table is replaced by the git-backed mapping that ships, the "What a storage backend MUST declare" subsection unchanged.
- desktop.md §10's marker stops naming an open part.
- The cloud adapter's module header agrees with §10.1, and `cloud-platform.test.ts` pins the three table facts that no test asserted.

## Decisions

- **Decided:** reconcile rather than build the sketched database, because the git-backed backend is deployed, §1's table ("Session gateway over git", "Git repository"), §4.5 and §10.1 already describe it, and no Studio code reads the old table.
- **Decided:** §10.2 states what the adapter asks of the gateway and what it observes (routes, the working tree, commit and branch semantics), not how the gateway stores a session, because the gateway ships outside this repository and nothing here can test its internals. The table names "the repository" and "the remote" rather than GitHub, because the protocol names no host.
- **Decided:** §10.2 keeps a sentence saying another backend may store projects in anything and that the MUST-declare list is what binds every backend, because that list already opens "Whatever it stores projects in", and the table is one deployment's mapping.
- **Decided:** fix `cloud.ts`'s module header in the same pull request, because it is the evidence file the new marker cites and it contradicts both §10.1 and the new discovery row. The cost is the `packages/studio` matrix and the screenshots lane for a comment; the three test cases below ride the same run.
- **Decided:** pin the three unasserted facts in `cloud-platform.test.ts`, because a reconciled section should cite tests for what it states, and each is one short case.
- **Decided:** the cloud adapter keeps declaring no `assetCapabilities`, because the MUST-declare list makes it optional and the gateway's real request limit is a number that lives outside this repository.
- **Decided:** fragment level `minor`, because the table was never built, so no author or backend relied on it.

## Implementation

1. `specs/desktop.md` §10.2 and §10: the in-place rewrite under "Specs & docs".
2. `packages/studio/src/platforms/cloud.ts`, module doc comment, replace lines 9 to 11 with:

   ```ts
    * Cloud omissions (Studio degrades per @jxsuite/protocol's route table): pickDirectory, package
    * install/outdated/set-versions (package ops are manifest-only edits), newWindow and pickProject,
    * gitClone, resolveClass, code services. Component discovery is not omitted: `discoverComponents`
    * walks the session's tree for the project's JSON components (desktop.md §10.2).
   ```

   No other source change. `plan:imports/cem-discovery-on-every-backend` edits the same three lines (its step 7 turns "component discovery" into "npm component discovery (imports.md §2)"), so whichever lands second merges the two: if it has landed first, keep its "npm component discovery (imports.md §2)" entry in the list above, between `resolveClass` and code services; if it lands second, it adds that entry to this text rather than looking for the old phrase.

3. `packages/studio/tests/cloud-platform.test.ts`:
   - `describe("discoverComponents")`: make the `session()` helper record every requested URL and return the array (`const urls: string[] = []; … urls.push(url); … return urls;`). Existing callers ignore the return value.
   - Add the three cases under Tests.

**Integration contract.** Once this lands, desktop.md §10.2 is Implemented and states the git-backed mapping: `project.json` is the branch's root file served as `projectConfig`, listings and file operations run against the session's working tree, a commit lands on the remote at once and `git/push` is a sync check, discovery is an adapter-side walk that never calls `components`, files are served under `raw/`, and a branch is its own session. The MUST-declare subsection is byte-identical. §10's marker names no open part. `plan:collab/attach-failure-state` edits §10.3 and `collab()` in `cloud.ts`, both disjoint from this text. `plan:imports/cem-discovery-on-every-backend` adds a sentence to §10.1 (the cloud discovers no dependency components), which the Component discovery row agrees with; if its Open decision goes the other way and the cloud adapter learns to discover them, that plan rewrites the row. The `session()` helper in the `discoverComponents` block returns its URL log for later cases.

## Tests

`cd packages/studio && bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts packages/studio` from the root.

New cases in `packages/studio/tests/cloud-platform.test.ts`:

- `describe("file operations")`, `createDirectory sends nothing: a git tree holds no empty directory`: `const calls = mockFetch();` then `await createCloudPlatform(PROJECT).createDirectory("pages/sub")`; `expect(calls).toEqual([])`.
- `describe("file operations")`, `uploadFile answers the path the gateway reports, not the one it asked for`: `mockFetch({ "path=public%2Fhero.png": { body: { path: "public/hero-1.png", size: 3 } }, "path=public%2Flogo.png": { body: { ok: true } } })`; uploading three bytes to `public/hero.png` resolves `{ path: "public/hero-1.png", size: 3 }`, and to `public/logo.png` resolves `{ path: "public/logo.png" }` (the fallback, with no `size` key).
- `describe("discoverComponents")`, `the walk reads the tree through files and file, never the components route`: the same tree as `finds a component nested in the tree`; after `discoverComponents()`, `urls` is non-empty and every entry starts with `${BASE}/files?dir=` or `${BASE}/file?path=`.

All three pin behaviour that already ships, so they pass before the comment edit too: a `reconcile` adds tests for what the rewritten section states, not red-to-green cases. Coverage: test-only plus a comment, so the per-file thresholds in `packages/studio/bunfig.toml` (lines 0.958, functions 0.941) and the manifest are unaffected, and `cloud.ts` is not the workspace's worst file; no ratchet.

## Specs & docs

**desktop.md §10** (in place): replace the marker's last sentence, so the line reads:

```markdown
> **Status: Implemented.** The adapter shipped and is deployed (§10.1), it keeps a project in its git repository (§10.2), and collaboration shipped as a CRDT (§10.3).
```

**desktop.md §10.2** (in place): replace the line-998 marker and everything from "The cloud backend stores projects in a database" through "…only the adapter implementation." with the block below. The `#### What a storage backend MUST declare` subsection and everything under it stay as written.

```markdown
> **Status: Implemented.** `packages/studio/src/platforms/cloud.ts` (`packages/studio/tests/cloud-platform.test.ts`); the upload answer is read by `packages/studio/src/files/media-upload.ts` (`packages/studio/tests/media-upload.test.ts`). The gateway is deployed from outside this repository, so this section states what the adapter asks of it, not how it stores a session.

The cloud backend is **git-backed**. A cloud project is a repository (§10.1), and a session is bound to one repository and one branch. It answers the protocol's routes (§5.1) under the session's base path, over a working tree of that branch:

| Filesystem concept  | Cloud equivalent                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.json`      | The file at the repository root on the session's branch. `project-info` answers it parsed, as `projectConfig`, and answers `null` for a repository that has none, which `probeRootProject` reports as not a site project.                                                                                                                           |
| Directory listing   | `files` lists the session's working tree: the branch's tree with the session's uncommitted writes applied. A git tree holds no empty directory, so a directory exists while a file is under it, and `createDirectory` sends nothing.                                                                                                                |
| File read/write     | `file`, `file/bytes`, `file/upload`, `file/rename` and a `file` DELETE, all against the working tree. A write stays uncommitted until `git/commit`, which lands the commit on the repository's branch at once and fails when that branch has moved since the session read it. Every commit is already on the remote, so `git/push` is a sync check. |
| Component discovery | A walk of the working tree in the adapter: `files` for each directory, `file` for each `.json` it finds, `componentMetaFrom` for the answer. It skips `node_modules`, build output and dot-directories and stops at a depth and a file count, because every step is a request. The adapter does not call `components`.                              |
| A file at a URL     | `raw/` under the session's base path, declared as `documentBaseUrl` together with `assetSpace: "repo"` (§3.1), because the editor's origin is shared and does not serve the site's URL space.                                                                                                                                                       |
| A branch            | A session of its own: `gitCheckout` navigates to that branch's editor URL instead of switching the tree in place.                                                                                                                                                                                                                                   |

The same PAL interface means Studio code doesn't change — only the adapter implementation. Another backend may keep projects in anything it likes: the table is the deployed backend's mapping, and what binds every backend is the list below.
```

Let `bun run format:md` (oxfmt) pad the table.

**Fragment**: `bun run spec:change desktop.md minor -m "§10.2 states the storage mapping that ships: a cloud project is its git repository, so project.json, directory listings, file reads and writes, commits and component discovery map onto the session's branch and working tree, and §10 no longer names an open part."`

**Docs** (no em dashes; none changes). No page's `spec:` cites `desktop.md#10` or `desktop.md#10.2`, and no page lists `cloud.ts` or `cloud-platform.test.ts` in `code:`, so `bun run docs:sync` names nothing. `docs/extending/embedding.md` names `cloud.ts` in its table as the cloud adapter's path, which stays true. `docs/extending/embedding/backend-protocol.md` already says a cloud backend may make commit and push atomic and treat `git/push` as a sync check. `docs/studio/projects.md` and `docs/studio/projects/create.md` already say a cloud project is a GitHub repository.

This plan does not graduate desktop.md: §3.1, §3.3, §3.6, §4.3, §5.3, §6.1 to §6.5, §7.4 and §9.3 stay open.

## Acceptance

- `cd packages/studio && bun test --isolate tests/cloud-platform.test.ts` lists the three new cases green; the full `bun test --isolate --coverage` from `packages/studio` and `bun scripts/check-coverage-manifest.ts packages/studio` pass.
- `grep -n "files table\|config JSON column\|one possible one\|The open part is" specs/desktop.md` prints nothing.
- `grep -n "component discovery, code services\|multi-window" packages/studio/src/platforms/cloud.ts` prints nothing.
- `bun run plans:status --spec desktop` no longer lists §10.2; `bun run plans:check --audit desktop` reports nothing for this plan (deleted in the landing pull request).
- `bun run docs:status`, `bun run docs:spec-release` (the fragment is present), `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown` and `bun run docs:standards` are green.
