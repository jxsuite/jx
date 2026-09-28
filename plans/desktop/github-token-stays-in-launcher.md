---
status: drafted
disposition: implement
claims:
  - desktop.md#3.6
requires: []
workspaces:
  - packages/desktop
  - packages/studio
  - specs
  - docs
size: M
---

# The GitHub token stays in the launcher, and Create GitHub Repository calls GitHub from the Bun process

## Context

`specs/desktop.md` §3.6, line 210:

> **Status: Partial.** The loopback redirect, PKCE, the callback's exemption and the owner-only credential store ship (`packages/server/src/oauth-loopback.ts`, `packages/desktop/src/github-signin.ts`, `packages/desktop/src/credential-store.ts`). The webview is handed the GitHub token: the `githubSignIn` request answers `{ token }` (`packages/desktop/src/rpc-schema.ts`), Studio holds it in memory for the session (`packages/studio/src/github/github-auth.ts`), and Create GitHub Repository sends it from the webview to the GitHub REST API (`packages/studio/src/github/github-publish.ts`).

§3.6 carried `Implemented` until the census. The handoff contradicts two of its sentences: "The RPC surface answers _whether_ a token exists and performs a sign-in; it never returns the store" (line 229), and "The GitHub token does not — only the launcher's sign-in flow touches it — so it lives in `credentials.json` and the webview is never handed it" (line 231).

**The exposure is wider than the stub said.** The stub framed it as "whether script in the webview can read it during a session in which the user signed in". In fact any script that can reach `globalThis.__jxPlatform` can read the stored token at any time, silently: `githubSignIn` without `force` answers a stored token with no browser and no prompt (`github-signin.ts` lines 78 to 83), and both adapters expose it as `githubAuth.signIn()`. On the chromium launcher that includes project content, because the canvas is same-origin with the shell (a relative `canvasUrl`, `/__studio__/canvas.html`, in `packages/desktop/src/chromium/platform.ts`; `packages/studio/src/canvas/iframe-host.ts` states the same-origin case) and unsandboxed. The token's scope is `repo` (`SCOPE` in `github-signin.ts`): read and write on every repository the user can reach.

**What exists**

- `packages/desktop/src/github-signin.ts`: `githubSignIn({ force })` runs the loopback flow or returns the stored token; `githubTokenStatus` answers `{ stored }`; `githubSignOut`. `readCredential(GITHUB_CREDENTIAL)` is read nowhere else.
- `rpc-schema.ts` declares `githubSignIn: { params: { force?: boolean }; response: { token: string } }` beside `githubToken` and `githubSignOut`. Both handler maps answer all three (`window-manager.ts` line 388, `chromium/index.ts` line 345), and both adapters forward them under the launcher-only `githubAuth` (`platform.ts` line 721, `chromium/platform.ts` line 373).
- `packages/studio/src/github/github-auth.ts`: `authenticateGithub()` resolves `string | null`; its desktop branch stores the answer in `nativeToken`, which `getGithubToken()` returns. `hydrateGithubToken(stored)` already carries only a boolean from `packages/desktop/src/boot.ts`.
- The one consumer: `createGithubRepository` in `github-publish.ts` POSTs `{ auto_init: false, description, name, private }` to `https://api.github.com/user/repos` with `Authorization: Bearer`, then runs `gitAddRemote` and `gitPush` through the PAL. The push authenticates with the user's own git credentials (`git push` in `packages/desktop/src/git.ts`), never this token. `signInToGithub` in `packages/studio/src/panels/git-panel.ts` only tests the result for truthiness.
- Tests: `packages/desktop/tests/github-signin.test.ts`; the handler-map cases and `_rpc-parity.ts` in `window-manager.test.ts` and `chromium-index.test.ts`; `packages/studio/tests/github-auth.test.ts`, `github-auth-gaps.test.ts`, `github-publish.test.ts`, `github-publish-gaps.test.ts`, `source-control-commands.test.ts`. No adapter test covers `githubAuth` (`platform.test.ts` covers `updater` and `windowControls` only).

**Not this plan's.** Who can reach `__jxPlatform` at all: the same-origin chromium canvas exposes every PAL member (`getSettings` with the AI key, `writeFile`, `gitPush`) to project content, which is not a §3.6 item. This plan removes the token from what that reach yields. The §3.1 extras paragraph that omits `githubAuth` is a rider on `plan:desktop/app-structure-tree`, whose text stays true here (`githubAuth` stays launcher-only and is still read only in `github-auth.ts`).

## Outcome

- `desktop.md` §3.6 → Implemented. The webview never holds the GitHub token on either launcher. `githubSignIn` answers `{ stored: true }`, and a new launcher request, `githubCreateRepository`, creates the repository from the Bun process and answers its URLs or a refusal. §3.6 states that every GitHub operation the webview needs is a named launcher request.
- The browser Studio is unchanged in behaviour: device flow, `localStorage`, and the REST call from the page.
- `desktop.md` stays Partial (§3.1, §3.3, §4.3, §5.3, §6.1 to §6.5, §7.4, §9.3 and §10.2 remain open), so nothing graduates.

## Decisions

- **Open:** implement or reconcile. Recommendation: implement, because the census understated the exposure (any script reaching `__jxPlatform`, including project content on chromium, reads a `repo`-scope token without a prompt), exactly one webview call needs the token, and §3.6's store rule is what justifies the AI key's opposite placement. Reconciling would leave that rule with a counterexample written into it.
- **Decided:** one named launcher request per GitHub operation, never a proxy, because a request that forwarded any path and body would hand the webview the token's whole scope by another name. A future GitHub call on the desktop (a pull request, a repository list) is another named request.
- **Decided:** refusal is a return value, `{ ok: false, reason, detail }` with `reason` one of `signed-out`, `unreachable` or `refused`, because the activity already words "could not reach GitHub" and "GitHub refused" differently, an RPC rejection carries only a message, and §3.5 sets the same precedent for `openExternal`.
- **Decided:** `githubCreateRepository` never starts a sign-in (no token answers `signed-out`), because Studio signs in before it shows the dialog, so a browser never opens in the middle of an activity. `githubSignIn` answers `{ stored: true }`, the `githubToken` shape.
- **Decided:** `authenticateGithub()` resolves a boolean on both builds, and `getGithubToken()` answers `null` whenever a launcher is present, because a return type that carries the token on one build is what put it in the webview. The browser REST call reads `getGithubToken()`.
- **Decided:** a 401 from GitHub is a `refused` like any other, and the launcher does not forget the stored token, because that is today's behaviour on both builds and Preferences › Accounts is where a credential is forgotten (studio.md §15).
- **Decided:** no new module, and nothing another package imports is renamed. The request lives in `github-signin.ts`, so one module reads and writes `GITHUB_CREDENTIAL` and its test file already stands up a temporary `0600` store. `githubAuth` and `hydrateGithubToken` keep their names, because renaming touches `boot.ts`, three init-shim tests and a docs sample for no behaviour. The one rename is private: `nativeAuth()` becomes the exported `nativeGithubAuth()`, because `github-publish.ts` now needs it and an exported `nativeAuth` would not say whose.
- **Decided:** the request and result types are defined once, in Studio's `github/github-auth.ts`, and the launcher imports them as types from `@jxsuite/studio/github-auth` (which `src/init.ts` already imports). Desktop depends on Studio and not the reverse (§2.3), so this is the one direction a single definition can take; two copies of a wire type would drift with nothing to catch it, and the chromium adapter's casts would hide the drift.
- **Decided:** no `requires` edge on `plan:studio-ui-guidelines/git-panel-action-list`. Both edit `github-publish.ts`, but that plan changes how the panel reaches `createGithubRepository({ projectName })` (and may add an init step), while this one changes how the first step reaches GitHub. Each is right without the other; whichever lands second rebases.

## Implementation

**Launcher (`packages/desktop`)**

1. `src/rpc-schema.ts`: `import type { GithubRepositoryRequest, GithubRepositoryResult } from "@jxsuite/studio/github-auth"` (step 6) and re-export both (`export type { … }`), so the launcher's modules keep importing wire types from `./rpc-schema`. `githubSignIn`'s response becomes `{ stored: boolean }`. Add `githubCreateRepository: { params: GithubRepositoryRequest; response: GithubRepositoryResult }` after `githubSignOut`, on its own `name: {` line so `declaredRpcRequests()` reads it. The comment above the block says four narrow requests and that none answers the token.
2. `src/github-signin.ts`:
   - `githubSignIn` returns `{ stored: true }` on both paths (the stored short-circuit, and after `writeCredential`). JSDoc: "Sign in, answering only that a token is now stored."
   - New `githubCreateRepository(params: GithubRepositoryRequest): Promise<GithubRepositoryResult>`. Read `readCredential(GITHUB_CREDENTIAL)`; `null` answers `signed-out` with `detail: "No GitHub account is signed in on this machine."` and makes no request. Otherwise `fetch(REPOS_ENDPOINT = "https://api.github.com/user/repos")` with `method: "POST"`, headers `Accept: application/vnd.github+json`, `Authorization: Bearer <token>`, `Content-Type: application/json`, body `{ auto_init: false, description, name, private: isPrivate !== false }` (Bun's fetch sends the `User-Agent` GitHub requires). The `!== false` is the trust boundary's: a request whose `isPrivate` is missing would otherwise drop the key in `JSON.stringify`, and GitHub creates a repository **public** when `private` is absent; erring private matches the dialog's own default. A rejected fetch answers `unreachable` with the error's message. A non-OK answer reads the body defensively (`.json()` in a try) and answers `refused` with `errors[0].message || message || "GitHub answered <status>."`, the same precedence `github-publish.ts` uses today. A 2xx answers `{ ok: true, cloneUrl: clone_url, htmlUrl: html_url }` and nothing else from GitHub's body.
   - Header comment: the token is read and written only here; the webview asks for verbs.
3. `src/window-manager.ts`: import `githubCreateRepository`; add `githubCreateRepository: (params) => githubCreateRepository(params)` beside the three GitHub handlers.
4. `src/chromium/index.ts`: the same, `githubCreateRepository: (params) => githubCreateRepository(params as GithubRepositoryRequest)`.
5. `src/platform.ts` and `src/chromium/platform.ts`: `githubAuth` gains `createRepository: (opts: GithubRepositoryRequest) => rpc.request.githubCreateRepository(opts)` (chromium: `request("githubCreateRepository", opts) as Promise<GithubRepositoryResult>`); chromium's `signIn` cast becomes `Promise<{ stored: boolean }>`. Each adapter's `githubAuth` literal ends `satisfies NativeGithubAuth` (a type import from `@jxsuite/studio/github-auth`), so a launcher whose members stop matching what Studio feature-detects fails `tsc` rather than a sign-in.

**Studio (`packages/studio`)**

6. `src/github/github-auth.ts`:
   - Export `GithubRepositoryRequest` as an alias of the dialog's `RepoOptions` (a type import from `../surfaces/github-publish`), `GithubRepositoryResult` (`{ ok: true; cloneUrl: string; htmlUrl: string } | { ok: false; reason: "signed-out" | "unreachable" | "refused"; detail: string }`), and `NativeGithubAuth`. Its `signIn` answers `{ stored: boolean }`; add `createRepository(opts: GithubRepositoryRequest): Promise<GithubRepositoryResult>`. These are the only definitions; the launcher imports them (step 1).
   - Rename `nativeAuth()` to `nativeGithubAuth()` and export it.
   - Delete `nativeToken`. `getGithubToken()` returns `nativeGithubAuth() ? null : localStorage.getItem(STORAGE_KEY)`. `githubTokenStored()` is `nativeStored || getGithubToken() !== null`. `clearGithubToken()` drops its `nativeToken` line.
   - `authenticateGithub(): Promise<boolean>`. The launcher branch runs first: `await native.signIn()`, set `nativeStored = true`, resolve `true`; a rejection reports as today and resolves `false`. It no longer short-circuits on a cached value, so each call asks the launcher, which answers a stored token without a browser and sees a sign-out from another window. The browser branch short-circuits on `getGithubToken()` and resolves `true`/`false` where it resolved the token/`null`.
   - Rewrite the header's token paragraph and `hydrateGithubToken`'s JSDoc: on the desktop the token never reaches this module.
7. `src/github/github-publish.ts`:
   - New private `requestRepository(opts: RepoOptions): Promise<GithubRepositoryResult>`. With `nativeGithubAuth()`, call `createRepository(opts)`, mapping a rejection to `refused` with its message. Without it, read `getGithubToken()` (null answers `signed-out`) and run today's `fetch` block, mapping a rejected fetch to `unreachable`, a non-OK answer to `refused` with today's message precedence, and a 2xx to `{ ok: true, cloneUrl, htmlUrl }`. Read a non-OK body in a try, as the launcher does: today's bare `await createRes.json()` rejects on a body that is not JSON (a proxy's 502 page), and `void createGithubRepository(…)` in `git-panel.ts` turns that into an unhandled rejection with the activity never failed.
   - `createGithubRepository`: `if (!(await authenticateGithub())) return false;`, then the dialog, then `activity.step(REPO_STEPS[0])` and `requestRepository`. On failure, `activity.log(detail)` and `activity.fail` with today's messages: `unreachable` is "Could not reach GitHub to create the repository." and `refused` is "Could not create the GitHub repository.", each with `action: "git.createGithubRepository"`; `signed-out` is "Sign in to GitHub to create the repository." with `action: "git.signInToGithub"`. On success, use `cloneUrl` and `htmlUrl` where `repo.clone_url` and `repo.html_url` are used today. `REPO_STEPS`, the signature and the return value are unchanged. Header: "this module keeps the requests and the activity; on the desktop the launcher holds the token".
8. `src/panels/git-panel.ts`, `signInToGithub`: `const signedIn = await authenticateGithub(); if (signedIn) …`.

**Integration contract.** Once this lands: `githubSignIn` answers `{ stored: boolean }` and no launcher request answers the token. `githubCreateRepository` (params `GithubRepositoryRequest`, answer `GithubRepositoryResult`, both defined in `packages/studio/src/github/github-auth.ts` and re-exported by `packages/desktop/src/rpc-schema.ts`) is answered by both launchers and forwarded as `githubAuth.createRepository` by both adapters, each checked against `NativeGithubAuth`. In Studio, `authenticateGithub(): Promise<boolean>`, exported `nativeGithubAuth()`, and `getGithubToken()` is `null` under a launcher. `createGithubRepository({ projectName })`, `REPO_STEPS`, and the two existing failure messages and their actions are unchanged (the `signed-out` failure is new), so `plan:studio-ui-guidelines/git-panel-action-list` can route the panel through the record either side of this. A new desktop GitHub operation follows §3.6's rule: one named request in `rpc-schema.ts` and both maps, implemented in `github-signin.ts`, forwarded under `githubAuth`.

## Tests

**`packages/desktop`** (`cd packages/desktop && bun test --isolate --coverage`):

- `tests/github-signin.test.ts`: "returns the stored token without sending anyone to a browser" becomes "a stored token answers signed in, without a browser and without the token" (`toEqual({ stored: true })`, `opened` empty). New "a completed sign-in stores the token and answers only that it is stored", for the second path, which no case reaches today (the existing flow cases all end in `stop()` or a refused browser): a real `createLoopbackAuthorizer()` host, `githubSignIn({ force: true })`, then `authorizer.handleCallback(new URL(redirectUri + "?code=c&state=" + state))` with `redirect_uri` and `state` read off `opened[0]`, and `globalThis.fetch` answering the token endpoint `{ access_token: "gho_fresh", token_type: "bearer" }`; expect `{ stored: true }` and `readCredential(GITHUB_CREDENTIAL)` to be `"gho_fresh"`. New `describe("githubCreateRepository")`, with `globalThis.fetch` replaced per case and restored in `afterEach`:
  - "creates the repository with the stored token and answers only its URLs": asserts URL, `POST`, the three headers, the body (`private` from `isPrivate`, `auto_init: false`), the result `toEqual({ ok: true, cloneUrl, htmlUrl })` although the stubbed 201 body carries more fields, and that `JSON.stringify(result)` does not contain the token.
  - "a request that names no visibility creates a private repository": params without `isPrivate`; the body carries `private: true`.
  - "no stored token answers signed-out without calling GitHub or a browser": a fetch stub that throws if called; `opened` empty.
  - "a request that never lands is unreachable": the rejection's message is the `detail`.
  - "GitHub's refusal carries GitHub's message": a 422 with `errors[0].message`, then with `message` only, then with an unparseable body (`"GitHub answered 422."`).
  - "a 401 is refused and the stored token is kept": `readCredential` still answers it afterwards.
- `tests/window-manager.test.ts` and `tests/chromium-index.test.ts`: the `../src/github-signin` doubles answer `{ stored: true }` and gain `githubCreateRepository`; the "GitHub sign-in handlers reach the loopback flow" cases assert the new answer and that `githubCreateRepository` forwards its params and returns the double's result. The existing parity cases (`declaredRpcRequests`) fail until both maps register it.
- `tests/platform.test.ts` and `tests/chromium-platform.test.ts`: new "githubAuth delegates each member to its request": `signIn()` and `signIn(true)` send `{ force: false }`/`{ force: true }`, `signOut`, `status`, and `createRepository(opts)` sends `githubCreateRepository` with `opts`. None of these arrows is covered today.

**`packages/studio`** (`cd packages/studio && bun test --isolate --coverage`):

- `tests/github-auth.test.ts` and `tests/github-auth-gaps.test.ts`: every browser case that expected a token expects `true` plus `getGithubToken()` equal to it, and every `null` becomes `false`. In "the desktop loopback flow", `NativeStub.signIn` answers `{ stored: true }` and the first case expects `true`, `getGithubToken()` null and `localStorage` empty. New cases: "the desktop never holds a token, even one a launcher offers" (a stub answering `{ stored: true, token: "gho_leak" }`; `getGithubToken()` stays null); "a browser-profile token is not consulted under a launcher" (`localStorage` seeded, launcher present: `getGithubToken()` is null and `signIn` is called once).
- `tests/github-publish.test.ts`: the `github-auth.js` double gains `nativeGithubAuth: () => native` (null by default) and `authenticateGithub` answers a boolean; existing browser cases keep their assertions. New `describe("on the desktop")`, with a fetch that throws on any call: "creates the repository through the launcher and sends nothing to GitHub from the webview" (`createRepository` called with the dialog's options, `gitAddRemote("origin", cloneUrl)`, `gitPush({ setUpstream: true })`, zero fetches, the success names `htmlUrl`); "unreachable fails the first step as unreachable"; "refused is the same failure as in a browser"; "signed-out asks for a sign-in and adds no remote" (action `git.signInToGithub`, `gitAddRemote` not called); "a launcher that rejects is reported, not swallowed". Two new browser cases for the branches the rewrite adds: "a token forgotten before the confirm answers signed-out without a request" (`authenticateGithub` answers `true`, `localStorage` empty: zero fetches, action `git.signInToGithub`), and "a refusal whose body is not JSON still fails the first step" (a 502 whose `json()` rejects: the activity fails with "Could not create the GitHub repository." and logs "GitHub answered 502.", where today the call rejects).
- `tests/github-publish-gaps.test.ts` and `tests/source-control-commands.test.ts`: the doubles answer booleans; the first adds `nativeGithubAuth: () => null`, because a mocked module missing a named import fails the file at link time.

**Coverage.** No new source file, so the manifest check sees the same set. Per-file thresholds: `packages/desktop/bunfig.toml` (`lines = 0.96, functions = 0.90`) holds `github-signin.ts`, `platform.ts` and `chromium/platform.ts`; `packages/studio/bunfig.toml` (`lines = 0.958, functions = 0.941`) holds `github-auth.ts` and `github-publish.ts`. If covering the `githubAuth` arrows lifts desktop's worst file, ratchet its threshold to just below the new minimum. Run `bun scripts/check-coverage-manifest.ts packages/desktop` and `packages/studio`.

## Specs & docs

**`specs/desktop.md` §3.6, in place:**

- Line 210: the Partial marker becomes `> **Status: Implemented.**`.
- Line 229, "The RPC surface answers _whether_ a token exists and performs a sign-in; it never returns the store." becomes "The RPC surface answers _whether_ a token exists, performs a sign-in, and makes the GitHub requests the webview needs; it never returns the token or the store."
- Line 231, "The GitHub token does not — only the launcher's sign-in flow touches it — so it lives" becomes "The GitHub token does not — the launcher's sign-in flow writes it and the launcher's own requests to GitHub read it — so it lives". The rest of the paragraph stays.
- A new paragraph after line 231, before the section's `---`: "**What the webview asks for is a verb, not a credential.** Each GitHub operation the webview needs is one launcher request that reads the token in the Bun process. `githubCreateRepository` takes a name, a description and a visibility (private unless the request says otherwise) and answers the new repository's clone and web URLs. A refusal is a return value, as in §3.5: `signed-out` when no token is stored (the request never starts a sign-in), `unreachable` when the request never reached GitHub, `refused` with GitHub's own message otherwise. `githubSignIn` answers only that a token is now stored. No request forwards an arbitrary path and body: that would hand script in the webview the token's whole `repo` scope under another name. The browser Studio has no launcher, so it keeps its device-flow token in `localStorage` and sends it itself."
- §12's RFC 8252 and RFC 7636 rows are unchanged; §3.6 has no Pending row, so no gap closes.

**Fragment:** `bun run spec:change desktop.md minor -m "§3.6: the GitHub token stays in the launcher. Sign-in answers only that a token is stored, Create GitHub Repository is a launcher request that calls GitHub from the Bun process and answers the new repository's URLs or a refusal, and §3.6 is Implemented."`

**Docs** (`bun run docs:sync` is advisory: it names the pages whose `code:` or `@docs` tag reaches a changed file and that the diff left alone; no page cites `desktop.md#3.6`, and `docs/extending/embedding.md` and `platform-adapter.md` cite `desktop.md#3`):

- `docs/studio/publish/github.md`: in the first doc-note, after "while the browser keeps it in that browser's storage.", add "In the desktop app the token never enters Studio's window: the app itself sends the request that creates your repository." Add `packages/desktop/src/github-signin.ts` to its `code:` list and an `@docs studio/publish/github` tag to that file's header. Its `description` ("authorize with a one-time code, then publish your project as a new repository") is wrong for the desktop and uses the verb `github-publish.ts` retired; replace it with "Connect Jx Studio to GitHub: sign in once, then create a repository for your project and push it in one flow." No em dashes.
- `docs/studio/publish.md`, `docs/studio/publish/source-control.md`, `docs/studio/desktop.md`, `docs/extending/embedding/platform-adapter.md`: named by `docs:sync` through `github-publish.ts`, `git-panel.ts`, `window-manager.ts` or the adapters; none describes the token or the create request (source-control's "Sign In to GitHub authorizes this machine" stays true), and the `bootLauncher` sample is unchanged. No edit.
- `docs/studio/interface/preferences.md` (Accounts): "the desktop app holds it in a file in its own configuration folder" stays true. No edit.

The landing pull request deletes this plan. It does not graduate `desktop.md`.

## Acceptance

- `cd packages/desktop && bun test --isolate --coverage` and `cd packages/studio && bun test --isolate --coverage` pass with their per-file thresholds; `bun scripts/check-coverage-manifest.ts packages/desktop` and `packages/studio` pass.
- `bun run --cwd packages/desktop typecheck`, `bun run typecheck`, `bun run lint` and `bun run lint:typecheck` pass.
- `rg -n "token: string" packages/desktop/src/rpc-schema.ts` finds nothing; `rg -n "GITHUB_CREDENTIAL" packages/desktop/src` finds only `github-signin.ts`; `rg -n "nativeToken" packages/studio/src` finds nothing; `rg -n "api.github.com" packages/studio/src` finds only the browser branch of `requestRepository`; `rg -n "type GithubRepositoryResult" packages` finds one definition, in `github-auth.ts`.
- In a desktop build (either launcher): sign in, run **Create GitHub repository**, and the activity completes. In the webview's devtools, `await __jxPlatform.githubAuth.signIn()` answers `{ stored: true }`, and the Network panel shows no request to `api.github.com`.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run docs:sync` names no page beyond those listed under Specs & docs; `bun run plans:status --spec desktop` no longer lists §3.6.
