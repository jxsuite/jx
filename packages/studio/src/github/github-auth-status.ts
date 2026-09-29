/**
 * The GitHub credential's state — whether one exists, where it lives, and how to forget it.
 *
 * Split out of `github-auth.ts` because a launcher's PAL-init bundle needs exactly one thing from
 * that module before Studio itself has loaded: {@link hydrateGithubToken}, so the accounts pane can
 * say "signed in" on the first frame (`desktop/src/boot.ts`). `github-auth.ts` also pulls in
 * `notify`, `../ui/layers` and the device-flow dialog surface for the actual sign-in UI — none of
 * which a bundler drops just because only this module's exports are imported, so a launcher that
 * imported the combined file got a second, independent copy of Lit's runtime alongside the one the
 * studio bundle it shares a window with already loads (`packages/desktop/src/init.ts`, the
 * "Multiple versions of Lit loaded" warning). This file has no UI dependency at all, so a launcher
 * that imports only this gets none of that.
 *
 * `github-auth.ts` re-exports everything here, so every other caller in Studio is unaffected.
 */

/// <reference lib="dom" />

const STORAGE_KEY = "jx_github_token";

/**
 * The desktop launcher's RFC 8252 sign-in, when this build is running inside one.
 *
 * Launcher-only, like `updater` and `windowControls`, and reached the same way — a loopback
 * redirect needs a loopback server, which a page in a browser does not have.
 */
export interface NativeGithubAuth {
  signIn: (force?: boolean) => Promise<{ token: string }>;
  signOut: () => Promise<{ ok: boolean }>;
  status: () => Promise<{ stored: boolean }>;
}

export function nativeAuth(): NativeGithubAuth | null {
  return (
    (globalThis as unknown as { __jxPlatform?: { githubAuth?: NativeGithubAuth } }).__jxPlatform
      ?.githubAuth ?? null
  );
}

/**
 * The token the desktop store handed us this session.
 *
 * On the desktop the token at rest is a `0600` file in the user's config directory, **not**
 * `localStorage` — so it is not readable by script in the webview between sessions, and it does not
 * survive in a place a stray extension or a copied profile can reach. Holding it in a module
 * variable is what keeps {@link getGithubToken} synchronous for its callers.
 */
let nativeToken: string | null = null;

/** Whether the desktop store holds a token, as of the last time it was asked. */
let nativeStored = false;

/** Record the token a native sign-in just returned — {@link authenticateGithub}'s own setter. */
export function setNativeToken(token: string | null): void {
  nativeToken = token;
}

/**
 * Record that the desktop's credential store does (or does not) hold a token.
 *
 * The launcher calls this once at startup. It carries a **boolean, not the token**: the accounts
 * pane only needs to know whether one exists, and handing the webview a credential it has not been
 * asked to use is the exposure the 0600 store exists to remove. When a sign-in does happen the
 * token arrives through {@link setNativeToken} and lives in memory for that session.
 *
 * @param {boolean} stored
 */
export function hydrateGithubToken(stored: boolean): void {
  nativeStored = stored;
}

/**
 * Whether a GitHub credential exists, wherever it lives.
 *
 * Separate from {@link getGithubToken} because the two questions genuinely differ on the desktop: a
 * token can be stored on disk and not yet in this session's memory, and the accounts pane asks
 * "signed in?" while rendering — synchronously — where an API caller asks for the credential itself
 * and can await it.
 *
 * @returns {boolean}
 */
export function githubTokenStored(): boolean {
  return nativeToken !== null || nativeStored || localStorage.getItem(STORAGE_KEY) !== null;
}

/** Where the credential this build would use actually lives, for text that says so. */
export function githubTokenLocation(): "desktop" | "browser" {
  return nativeAuth() ? "desktop" : "browser";
}

export function getGithubToken(): string | null {
  return nativeToken ?? localStorage.getItem(STORAGE_KEY);
}

export function clearGithubToken(): void {
  nativeToken = null;
  nativeStored = false;
  localStorage.removeItem(STORAGE_KEY);
  // Fire-and-forget: the accounts pane's revoke is synchronous, and a store that failed to forget
  // The token is not something the user can act on from there.
  void nativeAuth()
    ?.signOut()
    .catch(() => {});
}

/** The key {@link authenticateGithub}'s device flow writes the browser-stored token under. */
export { STORAGE_KEY };
