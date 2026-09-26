---
status: stub
disposition: implement
claims:
  - desktop.md#3.6
size: M
workspaces:
  - packages/desktop
  - packages/studio
---

# The GitHub token stays in the launcher, and Create GitHub Repository calls GitHub from the Bun process

## Context

`specs/desktop.md` §3.6, line 210:

> **Status: Partial.** The loopback redirect, PKCE, the callback's exemption and the owner-only credential store ship (`packages/server/src/oauth-loopback.ts`, `packages/desktop/src/github-signin.ts`, `packages/desktop/src/credential-store.ts`). The webview is handed the GitHub token: the `githubSignIn` request answers `{ token }` (`packages/desktop/src/rpc-schema.ts`), Studio holds it in memory for the session (`packages/studio/src/github/github-auth.ts`), and Create GitHub Repository sends it from the webview to the GitHub REST API (`packages/studio/src/github/github-publish.ts`).

§3.6 carried `Implemented` before the census, and the first pass kept it. Review found the handoff, which contradicts two sentences in the section. The first: "The RPC surface answers _whether_ a token exists and performs a sign-in; it never returns the store." The second, answering "does the webview have to send this credential itself?": "The GitHub token does not — only the launcher's sign-in flow touches it — so it lives in `credentials.json` and the webview is never handed it." The code does this on purpose. The comment on `hydrateGithubToken` says the token "arrives through `authenticateGithub` and lives in memory for that session".

Disposition `implement`, because §3.6's test for which store a credential belongs in turns on whether the webview must send it, and only one webview call needs the token. The detail phase should weigh `reconcile`: either way the token rests in the `0600` file, and the only difference is whether script in the webview can read it during a session in which the user signed in.

**What exists**

- `githubSignIn` in `packages/desktop/src/github-signin.ts`. It runs the loopback flow, or, without `force`, returns the stored token as it is. `packages/desktop/src/rpc-schema.ts` declares it as `{ token: string }`, and both launchers answer it (`packages/desktop/src/window-manager.ts`, `packages/desktop/src/chromium/index.ts`). Both adapters expose it as the launcher-only `githubAuth.signIn` (`packages/desktop/src/platform.ts`, `packages/desktop/src/chromium/platform.ts`).
- `githubToken`, which answers only `{ stored }`, and `githubSignOut`. Both already hold the spec's line.
- `authenticateGithub` in `packages/studio/src/github/github-auth.ts`, which keeps the answer in `nativeToken`, where `getGithubToken` returns it.
- The one consumer in the webview: `createGithubRepository` in `packages/studio/src/github/github-publish.ts`, which POSTs to `https://api.github.com/user/repos` with `Authorization: Bearer`. Adding the remote and pushing already go through the PAL (`gitAddRemote`, `gitPush`). `signInToGithub` in `packages/studio/src/panels/git-panel.ts` only reports whether a sign-in succeeded.
- `packages/desktop/tests/github-signin.test.ts` and the handler-map parity check in `packages/desktop/tests/_rpc-parity.ts`.

**What is missing**

- A launcher request that creates the repository in the Bun process: name, description and visibility in; the new repository's clone URL out. It needs a declaration in `rpc-schema.ts`, an answer from both launchers, and forwarding from both adapters under `githubAuth`.
- `githubSignIn` answering without the token, and `authenticateGithub` on the desktop keeping none. The browser Studio's device flow is unchanged.
- `createGithubRepository` using the launcher request where one exists.
- Tests on both handler maps, the parity check still passing, and a Studio test proving that the desktop path never holds a token.

**Related**

- desktop.md §3.1 (launcher-only extras are not PAL members), desktop.md §9.1 (the chromium handler map).
- studio.md §5.5 (the source control panel that starts the flow).
