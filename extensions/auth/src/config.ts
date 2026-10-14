/**
 * Config — the project.json `auth` section and its mapping onto BetterAuthOptions.
 *
 * The section carries identifiers and env-var NAMES only (specs/extensions.md §13): the signing
 * secret comes from `env[secretEnv]` (default BETTER_AUTH_SECRET), social-provider credentials from
 * their `clientIdEnv`/`clientSecretEnv` vars (defaults <ID>_CLIENT_ID / <ID>_CLIENT_SECRET). This
 * module is pure (its only runtime import is the schema guards) so browser bundles (session store,
 * actions) can share the section types and the SessionInfo mapping without pulling the Better Auth
 * server in.
 */

import { isString } from "@jxsuite/schema/guards";
import type { Dialect } from "kysely";
import type { HostEnv } from "@jxsuite/connector/provider-utils";
import type { AuthRecord, ConnectionDef, SessionInfo } from "@jxsuite/connector/types";

/** The Better Auth route subtree (specs/extensions.md §11: the auth mount's basePath). */
export const AUTH_BASE_PATH = "/_jx/auth";

/** Default NAME of the env var holding the Better Auth signing secret. */
export const DEFAULT_SECRET_ENV = "BETTER_AUTH_SECRET";

/**
 * How long a session lives, and how often activity extends it (seconds).
 *
 * These are Better Auth's own defaults, restated so the lifetime is **this project's** decision and
 * shows up in a diff when it changes. A session lifetime that lives only in a dependency's default
 * is one nobody chose.
 */
export const SESSION_EXPIRES_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_UPDATE_SECONDS = 60 * 60 * 24;

/** Auth-route rate limit: requests per IP per window (seconds). */
export const RATE_LIMIT_MAX = 100;
export const RATE_LIMIT_WINDOW_SECONDS = 10;

/** Better Auth's own cookie-name prefix. Changing it signs every existing session out. */
const COOKIE_PREFIX = "better-auth";

/** The cookies `createCookieGetter` mints, all of them same-host and `Path=/`. */
const COOKIE_IDS = ["session_token", "session_data", "dont_remember", "account_data"];

/**
 * Whether this deployment's cookies must carry `Secure` — and therefore a name prefix.
 *
 * **Default secure, and only step down when the origin is positively known to be plain HTTP.**
 * Better Auth's own rule falls back to `NODE_ENV === "production"`, which is _false on Cloudflare
 * Workers_ — where `NODE_ENV` is simply unset — so the library's default silently produced
 * unprefixed, non-`Secure` session cookies on exactly the platform Jx deploys to. The one host that
 * genuinely serves auth over plain HTTP is the local dev server, and it pins `BETTER_AUTH_URL` to
 * its own origin so this reads `http:` there rather than guessing.
 *
 * @param {HostEnv} env
 * @returns {boolean}
 */
export function cookiesAreSecure(env: HostEnv): boolean {
  const baseURL = env["BETTER_AUTH_URL"];
  if (isString(baseURL) && baseURL !== "") {
    return !baseURL.startsWith("http://");
  }
  return true;
}

/**
 * The `advanced` block: cookie names and attributes (RFC 6265bis §4.1.3).
 *
 * **`__Host-`, not `__Secure-`.** `__Secure-` only promises the cookie was set with `Secure`; a
 * page on a sibling origin — `evil.example.com` against `example.com` — can still overwrite it by
 * setting a `Domain`. `__Host-` forbids `Domain`, pins `Path=/`, and is therefore the prefix that
 * actually stops a session-fixation write. Better Auth's defaults already set `Path=/` and no
 * `Domain`, so the stronger prefix costs nothing.
 *
 * Getting there means turning **off** `useSecureCookies` and putting `Secure` back by hand: the
 * library prepends `__Secure-` to whatever name it is given, so leaving it on would mint
 * `__Secure-__Host-…`, a name no browser accepts. `secure: true` in `defaultCookieAttributes`
 * restores the attribute the flag would have set. `tests/config.test.ts` asserts the resulting
 * names, so a library upgrade that changes this is loud rather than silent.
 *
 * **`Partitioned` is not set, and must not default on.** CHIPS is for cookies in a _third-party_
 * context; Jx auth cookies are first-party to the site that serves them. Setting it would force
 * `SameSite=None; Secure` and partition the session per top-level site — signing a visitor out
 * whenever the embedding page changed.
 *
 * @param {boolean} secure
 * @returns {AuthAdvancedOptions}
 */
function advancedCookieOptions(secure: boolean): AuthAdvancedOptions {
  if (!secure) {
    // Plain-HTTP dev origin: a prefixed cookie without `Secure` is rejected outright.
    return { cookiePrefix: COOKIE_PREFIX, useSecureCookies: false };
  }
  const cookies: AuthCookieNames = {};
  for (const id of COOKIE_IDS) {
    cookies[id] = { name: `__Host-${COOKIE_PREFIX}.${id}` };
  }
  return {
    cookiePrefix: COOKIE_PREFIX,
    cookies,
    defaultCookieAttributes: { secure: true },
    useSecureCookies: false,
  };
}

/** Cookie names keyed by Better Auth cookie id (`session_token`, …). */
export type AuthCookieNames = Record<string, { name: string }>;

/** The `advanced` block of BetterAuthOptions this module sets (cookie names and attributes). */
export interface AuthAdvancedOptions {
  cookiePrefix: string;
  cookies?: AuthCookieNames;
  defaultCookieAttributes?: { secure: boolean };
  useSecureCookies: boolean;
}

/** One social provider entry: env-var NAMES for the OAuth credentials, never values. */
export interface AuthProviderDef {
  clientIdEnv?: string;
  clientSecretEnv?: string;
}

/** The project.json `auth` section (identifiers and env-var names only). */
export interface AuthSection {
  /** Connection holding the auth system tables; defaults to the first-declared connection. */
  connection?: string;
  secretEnv?: string;
  methods?: { emailPassword?: boolean };
  providers?: Record<string, AuthProviderDef>;
  redirects?: { afterSignIn?: string; afterSignOut?: string };
  roles?: string[];
  trustedOrigins?: string[];
}

/** The `connections`-bearing slice of a project config (the connector owns the full type). */
export interface AuthProjectConfig {
  connections?: Record<string, ConnectionDef>;
  auth?: AuthSection;
}

/** The connection name the auth tables live on: declared, else the first-declared connection. */
export function resolveAuthConnectionName(
  section: AuthSection,
  projectConfig: AuthProjectConfig,
): string {
  const name = section.connection ?? Object.keys(projectConfig.connections ?? {})[0];
  if (!name) {
    throw new Error(
      'The "auth" section needs a database connection, but the project declares none ' +
        '(add a "connections" entry, or set auth.connection)',
    );
  }
  return name;
}

/** The signing secret from `env[secretEnv]`, failing closed with the env-var name when unset. */
export function resolveAuthSecret(section: AuthSection, env: HostEnv): string {
  const name = section.secretEnv ?? DEFAULT_SECRET_ENV;
  const value = env[name];
  if (!isString(value) || value === "") {
    throw new Error(
      `Auth is not configured: set the ${name} secret (in .dev.vars locally, ` +
        `or \`wrangler secret put ${name}\` in production)`,
    );
  }
  return value;
}

/** Default env-var NAME for a provider credential (`github` → `GITHUB_CLIENT_ID`). */
function defaultProviderEnv(providerId: string, suffix: "CLIENT_ID" | "CLIENT_SECRET"): string {
  return `${providerId.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}_${suffix}`;
}

/** Resolved OAuth credentials per social provider id (Better Auth's `socialProviders` shape). */
export type AuthSocialProviders = Record<string, { clientId: string; clientSecret: string }>;

/**
 * Social providers with resolvable credentials, in Better Auth's `socialProviders` shape. Providers
 * whose env vars are unset are omitted (fail-closed: no half-configured OAuth).
 */
export function resolveSocialProviders(section: AuthSection, env: HostEnv) {
  const out: AuthSocialProviders = {};
  for (const [id, def] of Object.entries(section.providers ?? {})) {
    const clientId = env[def.clientIdEnv ?? defaultProviderEnv(id, "CLIENT_ID")];
    const clientSecret = env[def.clientSecretEnv ?? defaultProviderEnv(id, "CLIENT_SECRET")];
    if (isString(clientId) && clientId !== "" && isString(clientSecret)) {
      out[id] = { clientId, clientSecret };
    }
  }
  return out;
}

/** Better Auth's Kysely database config: the connection's dialect and its SQL family. */
export interface AuthDatabaseConfig {
  dialect: Dialect;
  type: "sqlite" | "postgres";
}

/**
 * The BetterAuthOptions this module produces (typed structurally — the exact BetterAuthOptions type
 * lives in better-auth, which this pure module never imports).
 */
export interface JxAuthOptions {
  baseURL?: string;
  advanced: AuthAdvancedOptions;
  basePath: string;
  emailAndPassword: { enabled: boolean };
  rateLimit: { enabled: boolean; max: number; window: number };
  session: { expiresIn: number; updateAge: number };
  socialProviders?: AuthSocialProviders;
  user?: {
    additionalFields: { role: { input: boolean; required: boolean; type: "string" } };
  };
  trustedOrigins?: string[];
  database?: AuthDatabaseConfig;
  secret?: string;
}

/**
 * Map the auth section + env onto BetterAuthOptions. Optional keys are present only when set.
 *
 * @param {AuthSection} section
 * @param {HostEnv} env
 * @param {object} [extras]
 * @param {AuthDatabaseConfig} [extras.database] - Better Auth database config ({ dialect, type })
 * @param {string} [extras.secret] - Signing secret (omit for secret-free uses like migrations)
 * @returns {JxAuthOptions} Options for `betterAuth()` / `getMigrations()`
 */
export function buildAuthOptions(
  section: AuthSection,
  env: HostEnv,
  extras: { database?: AuthDatabaseConfig; secret?: string } = {},
): JxAuthOptions {
  const socialProviders = resolveSocialProviders(section, env);
  const roles = section.roles ?? [];
  const baseURL = env["BETTER_AUTH_URL"];
  const pinned: Pick<JxAuthOptions, "baseURL"> = {};
  // Without BETTER_AUTH_URL Better Auth derives the origin from each incoming request, which
  // Is correct for same-origin /_jx/auth mounts; setting it pins callbacks for OAuth flows.
  if (isString(baseURL) && baseURL !== "") {
    pinned.baseURL = baseURL;
  }
  const options: JxAuthOptions = {
    ...pinned,
    advanced: advancedCookieOptions(cookiesAreSecure(env)),
    basePath: AUTH_BASE_PATH,
    emailAndPassword: { enabled: section.methods?.emailPassword ?? true },
    /*
     * Rate limiting is ON everywhere, not just in production. Better Auth gates its own default on
     * `NODE_ENV === "production"`, which is unset on Workers — so the limit was off in the one
     * place it matters. It is also on in dev deliberately: 100 requests per 10 seconds is far
     * beyond anything a person does by hand, and a limit that is disabled while you develop is a
     * limit nobody ever finds out is broken. Storage is Better Auth's in-memory default, which on
     * a serverless runtime is per-isolate — a speed bump for credential stuffing, not a wall.
     */
    rateLimit: { enabled: true, max: RATE_LIMIT_MAX, window: RATE_LIMIT_WINDOW_SECONDS },
    session: { expiresIn: SESSION_EXPIRES_SECONDS, updateAge: SESSION_UPDATE_SECONDS },
  };
  if (Object.keys(socialProviders).length > 0) {
    options.socialProviders = socialProviders;
  }
  if (roles.length > 0) {
    options.user = {
      additionalFields: {
        // Roles are assigned via the data grid, never by sign-up input.
        role: { input: false, required: false, type: "string" },
      },
    };
  }
  if (section.trustedOrigins && section.trustedOrigins.length > 0) {
    options.trustedOrigins = section.trustedOrigins;
  }
  if (extras.database !== undefined) {
    options.database = extras.database;
  }
  if (extras.secret !== undefined) {
    options.secret = extras.secret;
  }
  return options;
}

/**
 * A Better Auth session payload: `auth.api.getSession`'s result on the server (records carry `Date`
 * fields), or the client's parsed `getSession().data` (dates revived from ISO strings).
 */
export interface AuthSessionPayload {
  user?: AuthRecord | null;
  session?: AuthRecord | null;
}

/**
 * Map a Better Auth session payload ({ user, session }) onto the connector's SessionInfo shape.
 *
 * @param {AuthSessionPayload | null | undefined} data - `auth.api.getSession` result or the
 *   client's `getSession().data`
 * @returns {SessionInfo | null}
 */
export function toSessionInfo(data: AuthSessionPayload | null | undefined): SessionInfo | null {
  if (!data) {
    return null;
  }
  const { user, session } = data;
  if (!user || !isString(user.id)) {
    return null;
  }
  const info: SessionInfo = { userId: user.id };
  if (isString(user.role) && user.role !== "") {
    info.role = user.role;
  }
  info.user = user;
  if (session !== undefined) {
    info.session = session;
  }
  return info;
}
