# `@jxsuite/server`

> Development server for Jx projects with live reload, proxy resolution, and Studio API, plus the project server, package operations and package service that also run on Node.

## Overview

`@jxsuite/server` provides a single `createDevServer()` call that covers live reload, `$src`/`$prototype` proxy resolution (Node.js-side), `timing: "server"` function execution, a Studio filesystem API, and OXC-powered code services.

## Installation

```bash
bun add @jxsuite/server
```

## Usage

```js
import { createDevServer } from "@jxsuite/server";

await createDevServer({
  root: "./my-project",
  port: 3000,
  builds: [{ entrypoints: ["./index.html"], outdir: "./dist", label: "app" }],
});
```

## Endpoints

### Live reload: `GET /__reload`

SSE endpoint. `chokidar` watches the project root and pushes change events to connected browsers, triggering automatic page reload.

### `$prototype`/`$src` proxy: `POST /__jx_resolve__`

Resolves external `$prototype` data sources server-side. Supports `.js` modules and `.class.json` schemas. Avoids browser CORS issues and enables Node.js-only dependencies (`fs`, `glob`, etc.).

### Server functions: `POST /__jx_server__`

Executes `timing: "server"` function entries during development. The runtime sends `{ $src, $export, arguments }` and receives the return value as JSON.

### Studio filesystem API: `/__studio/*`

REST API for the Studio visual builder:

| Method         | Path                    | Description                |
| -------------- | ----------------------- | -------------------------- |
| GET            | `/__studio/project`     | Project metadata           |
| GET            | `/__studio/files`       | Directory listing          |
| GET/PUT/DELETE | `/__studio/file`        | Read / write / delete file |
| POST           | `/__studio/file/rename` | Rename or move file        |
| GET            | `/__studio/components`  | Discover custom elements   |
| GET            | `/__studio/search`      | Search file contents       |

All file operations are constrained to the project root (path traversal is rejected).

### Code services: `/__studio/code/*`

OXC-powered tools for the Studio function body editor:

| Endpoint                     | Tool             | Description         |
| ---------------------------- | ---------------- | ------------------- |
| `POST /__studio/code/format` | oxfmt            | Format a JS snippet |
| `POST /__studio/code/minify` | `Bun.Transpiler` | Minify a JS snippet |
| `POST /__studio/code/lint`   | oxlint           | Lint a JS snippet   |

## Build pipeline

`buildAll(options)` uses `Bun.build` to bundle entrypoints. Incremental rebuilds (`rebuild(changedPath)`) are triggered by the file watcher and reprocess only affected entrypoints.

## Dependencies

| Package    | Purpose                       |
| ---------- | ----------------------------- |
| `chokidar` | File watching for live reload |

| `@npmcli/arborist` | Package operations (npm's installer) |
| `npm-package-arg` | Validating a package spec before anything is installed |
| `ws` | WebSockets for `serve()` on Node |

`createDevServer()` and the build pipeline run on Bun (`Bun.serve`, `Bun.build`, `Bun.Transpiler`).

## Running on Node

The desktop app runs the project server on the Node inside Electron, so everything it loads is runtime-neutral, with the Bun implementation chosen by the `bun` export condition:

- **`@jxsuite/server/serve`**: `serve()`, one HTTP and WebSocket server over `Bun.serve` under Bun and `node:http` with `ws` under Node. It is async, because Node binds asynchronously.
- **`@jxsuite/server/fs-glob`** and **`@jxsuite/server/file-response`**: globbing and file responses that answer as Bun's own built-ins do.
- **`@jxsuite/server/packages`**: add, remove, install and update-versions, run in-process on npm's Arborist. Install scripts never run, only the public registry is read, and the operation writes `package-lock.json` (a project's `bun.lock` is replaced on its first install).
- **`@jxsuite/server/packages-service`**: the same operations over HTTP, lockfile-only, for a host with no filesystem of its own. The Jx cloud platform runs it from the [jxsuite/package-manager](https://github.com/jxsuite/package-manager) container image.

## Upgrading to 8.0

8.0 is the release that made the server runtime-neutral. Code that imports these from `@jxsuite/server` needs to change:

- `createProjectServer()`, `startSitePreview()`, `sitePreviewOrigin()` and `stopSitePreviews()` return promises. Await them.
- `documentGlob()` returns the glob pattern as a string instead of a `Bun.Glob`. Scan it with `scanFiles()` from `@jxsuite/server/fs-glob`.
- `bunExecutable()` is removed: package operations no longer run a package manager in a subprocess.
- `installDependencies()`, `addPackage()`, `removePackage()` and `setPackageVersions()` take an options argument and write `package-lock.json` rather than `bun.lock`.

## License

MIT
