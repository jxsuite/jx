/// <reference lib="dom" />
/**
 * Chooses the default PAL adapter when no platform was pre-registered on `window.__jxPlatform` — or
 * refuses to, when a launcher was supposed to have registered one.
 *
 * The cloud shell (the platform repo's `web/edit-init.ts`) publishes a `window.__jxCloud` signal
 * _instead of_ constructing the adapter itself, so the cloud adapter — and its collab WebSocket
 * client, which owns the shared `Y.Doc` — is created HERE, inside the studio bundle, sharing
 * studio's single `yjs` instance. Creating it in the shell bundle loads a SECOND `yjs`, which
 * breaks collab's cross-module `instanceof` checks (the Y↔JxDocOp conversion silently stops
 * reconciling). The dev server sends no signal and gets the dev-server adapter.
 *
 * **This resolver DOES run on desktop — whenever desktop failed.** A launcher registers its own
 * adapter on `__jxPlatform` from a boot module that evaluates before this bundle, and this header
 * used to conclude that the resolver never ran there. That held only while the boot module worked.
 * Desktop 5.0.0 to 5.1.3 shipped an init bundle that threw on import, nothing registered, and this
 * resolver answered with the dev-server adapter inside a `views://` window: every panel drew,
 * "Create Project" said "Failed to fetch", and Browse did nothing at all. A half-working app is the
 * worst failure a launcher can have, because it reads as a bug in whatever the user clicked last.
 *
 * So the fallback is now conditional on there being nobody it could be standing in for.
 * {@link bootRefusal} is that decision, and {@link resolveDefaultPlatform} throws
 * {@link PlatformUnavailableError} rather than guess; `studio.ts` catches it and draws the
 * boot-failure screen (`surfaces/boot-failure.ts`) in place of the frame.
 *
 * @docs extending/embedding/platform-adapter
 */
import { BOOT_META } from "../hosting/document";
import { launcherSignal } from "../platform";
import type { LauncherSignal } from "../platform";
import type { StudioPlatform } from "../types";
import type { CloudProject } from "./cloud";
import { createCloudPlatform } from "./cloud";
import { createDevServerPlatform } from "./devserver";

/** Cloud shell handshake: presence signals cloud; `project` is null for the /studio hub. */
export interface CloudSignal {
  project: CloudProject | null;
}

/**
 * Why Studio will not fall back to the dev-server adapter, most specific evidence first.
 *
 * - `launcher` — a launcher's boot module announced itself (`globalThis.__jxLauncher`) and still no
 *   adapter was registered. The strongest evidence there is: the launcher ran, failed, and may have
 *   recorded why. The error is deliberately NOT copied here — the failure view reads
 *   `launcherSignal()?.error` when it renders, so an error recorded after this was decided still
 *   reaches the screen.
 * - `declared` — the document carries {@link BOOT_META}, so its host declared a boot module, and
 *   nothing announced. The boot script never ran: a 404, a syntax error, a blocked load.
 * - `scheme` — neither, but the page was opened from `views:` or `file:`. The dev-server adapter is
 *   relative `fetch`, `EventSource` and a WebSocket against the page's own origin, and those two
 *   schemes have no HTTP server behind them by construction. This covers a staged `index.html` old
 *   enough to predate the meta.
 */
export type BootRefusal =
  | { kind: "launcher"; launcher: string | undefined }
  | { kind: "declared" }
  | { kind: "scheme"; protocol: string };

/** The four facts {@link bootRefusal} decides from, read once so the rule itself stays pure. */
export interface BootEnvironment {
  /** The launcher signal, when a launcher's boot module announced itself. */
  launcher: LauncherSignal | undefined;
  /** Whether the cloud shell published its `__jxCloud` signal. */
  cloud: boolean;
  /** Whether the document carries the {@link BOOT_META} marker. */
  declared: boolean;
  /** `location.protocol`, colon included. */
  protocol: string;
}

/**
 * Schemes the dev-server adapter can never work from.
 *
 * ONLY these two, and the list is short on purpose. The embedding docs promise that a host serving
 * the HTTP protocol reuses the stock dev-server adapter unchanged, and a third-party shell may well
 * serve it through a custom scheme — `tauri://localhost` proxies to a real server. Refusing every
 * scheme that is not `http:` would break that host to cover a case the meta and the launcher signal
 * already cover for every host this repository ships. `views:` is Electrobun's own bundle scheme
 * and `file:` is a document opened from disk; neither can be proxying anything. happy-dom's
 * `about:` is absent for the same reason, which is also what lets a test import the entry without
 * inventing a URL.
 */
const BACKENDLESS_SCHEMES: ReadonlySet<string> = new Set(["views:", "file:"]);

/** Read the boot environment from the live globals and document. */
export function bootEnvironment(): BootEnvironment {
  const doc = (globalThis as { document?: Document }).document;
  const meta = `meta[name="${BOOT_META.name}"][content="${BOOT_META.content}"]`;
  return {
    cloud: (globalThis as unknown as { __jxCloud?: CloudSignal }).__jxCloud != null,
    declared: doc?.querySelector(meta) != null,
    launcher: launcherSignal(),
    protocol: (globalThis as { location?: Location }).location?.protocol ?? "",
  };
}

/**
 * Whether the dev-server fallback must be refused, and why — `null` when it may run.
 *
 * The order is the argument. A launcher signal beats the cloud signal because it is direct evidence
 * of a launcher that failed, and a window is not both. The cloud signal beats the meta because the
 * cloud shell declares a boot module too — `edit-init.js` IS its boot module — and publishing the
 * signal is that module succeeding.
 *
 * @param env The environment to judge; the live one by default.
 */
export function bootRefusal(env: BootEnvironment = bootEnvironment()): BootRefusal | null {
  if (env.launcher) {
    return { kind: "launcher", launcher: env.launcher.launcher };
  }
  if (env.cloud) {
    return null;
  }
  if (env.declared) {
    return { kind: "declared" };
  }
  if (BACKENDLESS_SCHEMES.has(env.protocol)) {
    return { kind: "scheme", protocol: env.protocol };
  }
  return null;
}

/** The console's one-line account of a refusal; the screen says it at more length. */
function refusalMessage(refusal: BootRefusal): string {
  switch (refusal.kind) {
    case "launcher": {
      return `Jx Studio's launcher (${refusal.launcher ?? "unnamed"}) announced itself but registered no platform adapter.`;
    }
    case "declared": {
      return "Jx Studio's page declares a boot module, but nothing registered a platform adapter.";
    }
    default: {
      return `Jx Studio was opened from a ${refusal.protocol} URL, which has no backend for the dev-server adapter.`;
    }
  }
}

/** Thrown by {@link resolveDefaultPlatform} when {@link bootRefusal} refuses the fallback. */
export class PlatformUnavailableError extends Error {
  readonly refusal: BootRefusal;

  constructor(refusal: BootRefusal) {
    super(refusalMessage(refusal));
    this.name = "PlatformUnavailableError";
    this.refusal = refusal;
  }
}

/**
 * The cloud adapter when the shell signalled cloud, else the dev-server adapter.
 *
 * @throws {PlatformUnavailableError} When a launcher was declared or announced and registered
 *   nothing, or the page's scheme has no server behind it — see {@link bootRefusal}.
 */
export function resolveDefaultPlatform(): StudioPlatform {
  const refusal = bootRefusal();
  if (refusal) {
    throw new PlatformUnavailableError(refusal);
  }
  const cloud = (globalThis as unknown as { __jxCloud?: CloudSignal }).__jxCloud;
  return cloud ? createCloudPlatform(cloud.project) : createDevServerPlatform();
}
