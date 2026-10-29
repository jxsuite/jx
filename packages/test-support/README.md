# @jxsuite/test-support

Private and test-only: never published. It holds the shared `bun test` preload that every workspace whose tests use happy-dom names in its `bunfig.toml`:

```toml
[test]
preload = ["@jxsuite/test-support/preload"]
```

Before every test file, `--isolate` included, the preload does three things:

- **Compact DOM printing** (`src/inspect-dom.ts`). Bun inspects both operands of a failing `toBe`, and a live kit element reaches its whole reactive graph. A hook on happy-dom's `Node.prototype` prints each node as one line instead: its opening tag, a few attributes and an identity marker (`#7`).
- **No deep equality on DOM nodes** (`src/dom-equality.ts`). Bun's diff printer for a failing `toEqual` ignores that hook and hangs on a live element. `toEqual`, `toStrictEqual`, `toMatchObject` and `toContainEqual` (with `.not`, `.resolves` and `.rejects`), plus `expect.objectContaining` and `expect.arrayContaining`, throw at once when either side is a node or holds one a few levels down: in arrays, maps, sets, plain objects, or the own properties of a class instance (an `Event`'s target, a `MutationRecord`, a record class of the test's own). The other deep comparisons are guarded by what their failure prints: `toHaveProperty(path, value)` searches the value at `path` and `value`; `toHaveBeenCalledWith` / `toBeCalledWith` search the expected arguments and every recorded call; the last-call and nth-call forms search only that call. Compare a recorded node with `toBe` on `mock.calls[i][j]`. `toBe`, `toContain` and `toHaveReturnedWith` print nodes through the compact hook and need no guard. Everything else reaches Bun's own matcher, diff included.
- **The Bun pin** (`src/bun-pin.ts`). A local Bun other than the repository's `.bun-version`, which CI installs exactly, prints one warning line on stderr. It never fails the run: nothing it does on disk may throw, and where the temporary directory cannot be written, the line is printed per file instead of once.

Compare nodes by identity with `toBe`. Compare a list of nodes with `identities()`, which turns each into its one-line form, so a failure diffs readable lines:

```ts
import { identities } from "@jxsuite/test-support/inspect-dom";

expect(identities(seen)).toEqual(identities([first, second]));
```

It depends on no `@jxsuite` package, so any workspace can preload it without a dependency cycle. A consumer lists it as a devDependency, which is also the edge that makes CI retest every consumer when this package changes, and ignores `../test-support/**` in its coverage, because this package's own run gates it at 100%.

It also holds one helper for tests that build a project in the system temporary directory. An extension resolves from the project's own `node_modules`, never from the host, so such a project has none until a test gives it one. `installWorkspaceExtension(root, ...names)` links each workspace package into `<root>/node_modules`, as `bun install` would:

```ts
import { installWorkspaceExtension } from "@jxsuite/test-support/install-extension";

installWorkspaceExtension(root, "@jxsuite/parser");
```
