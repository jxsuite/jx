/**
 * Worker — the /_jx/auth mount (specs/extensions.md §11, order 10).
 *
 * `Auth.mount(options, ctx)` publishes the auth hooks on the shared server context — `ctx.auth = {
 * getSession, authorize }` — and returns a fetch-style handler delegating to Better Auth's own
 * request handler for everything under the base path (sign-up, sign-in, sign-out, get-session,
 * social callbacks). The data mount (order 20) consumes ctx.auth; without this mount it fails
 * closed. Better Auth instances are memoized per env identity: hosts pass one stable env object per
 * isolate (the generated worker's c.env, the dev server's merged .dev.vars env), so the instance —
 * and its database connection — is created once. Runs on Workers, Bun, and node.
 */

import { evaluatePermission } from "./authorize.ts";
import { createJxAuth, getAuthMigrations, getSessionContext } from "./server.ts";
import type { HostEnv } from "@jxsuite/connector/provider-utils";
import type {
  AuthorizeDecision,
  AuthorizeInput,
  ConnectionDef,
  JxServerContext,
  SessionInfo,
} from "@jxsuite/connector/types";
import type { AuthConnectorProvider, JxAuthInstance } from "./server.ts";
import type { AuthProjectConfig, AuthSection } from "./config.ts";

export interface AuthMountOptions {
  /** Route subtree this mount owns. Defaults to "/_jx/auth". */
  basePath?: string;
  /** Extension-contributed project sections (needs `auth` and `connections`). */
  sections: {
    auth?: AuthSection;
    connections?: Record<string, ConnectionDef>;
  };
  /** Provider implementations keyed by `connector.provider` id (dev stand-ins applied by hosts). */
  connectors?: Record<string, AuthConnectorProvider>;
  /** Run Better Auth's additive migrations on first touch (dev server / local sqlite). */
  autoSync?: boolean;
}

/** Per-isolate mount state: Better Auth instances memoized per env identity. */
export interface AuthMountState {
  auths: WeakMap<HostEnv, Promise<JxAuthInstance>>;
}

/** Create fresh mount state (exported for hosts that dispatch without `Auth.mount`). */
export function createAuthMountState(): AuthMountState {
  return { auths: new WeakMap() };
}

/** The auth section plus the project-config slice the auth modules resolve it against. */
interface AuthMountConfig {
  section: AuthSection;
  projectConfig: AuthProjectConfig;
}

/** The project-config slice the auth modules need, rebuilt from the mount's section manifest. */
function configFromSections(options: AuthMountOptions): AuthMountConfig {
  const section = options.sections.auth ?? {};
  return {
    projectConfig: { auth: section, connections: options.sections.connections ?? {} },
    section,
  };
}

/** Open (or reuse) the Better Auth instance for an env identity. */
export function getAuthForEnv(
  state: AuthMountState,
  options: AuthMountOptions,
  env: HostEnv,
): Promise<JxAuthInstance> {
  const memo = state.auths.get(env);
  if (memo) {
    return memo;
  }
  const { section, projectConfig } = configFromSections(options);
  const open = createJxAuth(section, projectConfig, env, {
    autoSync: options.autoSync ?? false,
    connectors: options.connectors,
  });
  state.auths.set(env, open);
  open.catch(() => state.auths.delete(env));
  return open;
}

/**
 * Handle one /_jx/auth request by delegating to Better Auth's fetch handler.
 *
 * @param {Request} request
 * @param {HostEnv} env - Worker env (bindings + vars; the signing secret lives here)
 * @param {AuthMountOptions} options
 * @param {AuthMountState} [state] - Memoized instances; omit for a throwaway state
 * @returns {Promise<Response>}
 */
export async function handleAuthRequest(
  request: Request,
  env: HostEnv,
  options: AuthMountOptions,
  state: AuthMountState = createAuthMountState(),
): Promise<Response> {
  try {
    const auth = await getAuthForEnv(state, options, env);
    const response = await auth.handler(request);
    return isSignOut(request) && response.ok ? clearingSiteData(response) : response;
  } catch (error) {
    /* The cause names a secret's env var, a connection or a driver. It is the owner's to read in
       the log; a visitor is told only that sign-in is not working. */
    console.error("jx auth: request failed:", error);
    return Response.json({ error: "Authentication is unavailable" }, { status: 500 });
  }
}

/** Whether a request is the sign-out call, whatever base the site is deployed under. */
function isSignOut(request: Request): boolean {
  return request.method === "POST" && new URL(request.url).pathname.endsWith("/sign-out");
}

/**
 * The same response, asking the browser to drop what it cached for this origin.
 *
 * Better Auth expires the session cookie, which ends the session and leaves every page the person
 * saw while signed in one Back press away: in the HTTP cache, and in the back/forward cache, which
 * restores a page without asking the server anything. `"cache"` empties both. `"storage"` is
 * deliberately not sent: it would also delete the site's own localStorage (a theme, a cart) and
 * unregister its service worker, which is the site's decision and not this mount's.
 */
function clearingSiteData(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Clear-Site-Data", '"cache"');
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/** The mount + section-owner class for the `auth` section. */
export const Auth = {
  /**
   * Static `mount` capability (specs/extensions.md §11): publishes ctx.auth for later mounts and
   * returns the Better Auth route handler.
   */
  mount(options: AuthMountOptions, ctx: JxServerContext) {
    const state = createAuthMountState();
    ctx.auth = {
      authorize: (input: AuthorizeInput): Promise<AuthorizeDecision> =>
        Promise.resolve(evaluatePermission(input)),
      getSession: async (request: Request, env: HostEnv): Promise<SessionInfo | null> => {
        try {
          const auth = await getAuthForEnv(state, options, env);
          return await getSessionContext(auth, request);
        } catch (error) {
          // Fail-closed: an unconfigured/unreachable auth backend means "signed out", never a
          // Silent grant. The cause is surfaced once here rather than as a 500 per data request.
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`jx auth: session resolution failed: ${message}`);
          return null;
        }
      },
    };
    return (request: Request, env: HostEnv): Promise<Response> =>
      handleAuthRequest(request, env, options, state);
  },

  /** Static `projectData` capability: expose the auth section as `_project.auth`. */
  projectData(sectionValue: AuthSection | null | undefined): AuthSection {
    return { ...sectionValue };
  },

  /**
   * Static `deploySchema` capability (section-owner variant): compile Better Auth's additive
   * system-table migration into push steps the host composes after the connector plan.
   *
   * @param {AuthSection | null | undefined} sectionValue - The project.json `auth` section value
   * @param {AuthProjectConfig | null | undefined} projectConfig - The full project config
   *   (connection lookup)
   * @param {object} options - { env, dryRun?, connection?, connectors? }
   * @returns {Promise<object>} { steps, applied, warnings, connection }
   */
  async deploySchema(
    sectionValue: AuthSection | null | undefined,
    projectConfig: AuthProjectConfig | null | undefined,
    options: {
      env: HostEnv;
      dryRun?: boolean;
      connection?: string;
      connectors?: Record<string, AuthConnectorProvider>;
    },
  ) {
    const section = sectionValue ?? {};
    const config = projectConfig ?? {};
    const dryRun = options.dryRun === true;
    const migrations = await getAuthMigrations(section, config, options.env, {
      connectors: options.connectors,
    });
    if (options.connection !== undefined && options.connection !== migrations.connection) {
      // The push targets a different connection — nothing to contribute.
      return { applied: false, connection: migrations.connection, steps: [], warnings: [] };
    }
    if (!dryRun) {
      await migrations.apply();
    }
    return {
      applied: !dryRun && migrations.steps.length > 0,
      connection: migrations.connection,
      steps: migrations.steps,
      warnings: [],
    };
  },
};
