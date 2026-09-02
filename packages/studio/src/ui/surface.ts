/**
 * The one way a Studio surface document is mounted.
 *
 * A surface is a Jx document under `src/surfaces/`, bundled as JSON and registered here by name.
 * The adapter that owns a surface builds a scope of host records and functions and calls
 * `mountSurface`; this module waits for the kit, mounts through the runtime's `mount()` with the
 * surfaces' own base and resolver so a document's `$ref`s resolve with no network, stamps the
 * host's region id, and records the mount so a redefinition or a saved edit can find it
 * (specs/studio-ui-guidelines.md §9.3, specs/embedding.md §2).
 *
 * @docs extending/ui-kit
 */
import { mount, preloadDocument } from "@jxsuite/runtime";
import type { JxMountOptions, JxScope } from "@jxsuite/runtime/types";
import type { JxDocument } from "@jxsuite/schema/types";
import { registerMount, unregisterMount } from "../services/surface-registry";
import { kitReady } from "./kit";
import { REGION_ATTR } from "./regions";

/** The URL every surface document is known by: `jx-studio:/surfaces/<name>.json`. */
export const SURFACES_BASE = "jx-studio:/surfaces/";

const surfaces = new Map<string, JxDocument>();

/**
 * Register a surface document under a name. Bundled JSON, so it is also preloaded under its URL for
 * the runtime's own resolution paths.
 */
export function registerSurface(name: string, doc: JxDocument): void {
  surfaces.set(name, doc);
  preloadDocument(surfaceUrl(name), doc);
}

/** The URL a surface name resolves to. */
export function surfaceUrl(name: string): string {
  return `${SURFACES_BASE}${name}.json`;
}

/** The registered document for a name, if any. */
export function surfaceDocument(name: string): JxDocument | undefined {
  return surfaces.get(name);
}

/** The mount resolver: answers surface URLs from the registry and nothing else. */
export function surfaceResolver(url: string): JxDocument | undefined {
  if (!url.startsWith(SURFACES_BASE) || !url.endsWith(".json")) {
    return undefined;
  }
  return surfaces.get(url.slice(SURFACES_BASE.length, -".json".length));
}

export interface SurfaceHandle {
  readonly scope: JxScope;
  readonly root: HTMLElement | Text;
  readonly elements: ReadonlySet<string>;
  readonly dispose: () => void;
}

export interface MountSurfaceOptions {
  /** A `data-jx-region` id stamped on the host, so the screenshot pipeline can address it. */
  region?: string;
  onNodeCreated?: JxMountOptions["onNodeCreated"];
  onNodeMoved?: JxMountOptions["onNodeMoved"];
  signal?: AbortSignal;
}

/**
 * Mount a registered surface into a host node with the given host scope.
 *
 * @throws {Error} When no document is registered under `name`
 */
export async function mountSurface(
  name: string,
  hostScope: Record<string, unknown>,
  host: HTMLElement,
  options: MountSurfaceOptions = {},
): Promise<SurfaceHandle> {
  const doc = surfaces.get(name);
  if (!doc) {
    throw new Error(`Studio surface "${name}" is not registered`);
  }
  await kitReady();
  if (options.region) {
    host.setAttribute(REGION_ATTR, options.region);
  }
  const handle = await mount(doc, host, {
    scope: hostScope,
    base: SURFACES_BASE,
    resolver: surfaceResolver,
    ...(options.onNodeCreated ? { onNodeCreated: options.onNodeCreated } : {}),
    ...(options.onNodeMoved ? { onNodeMoved: options.onNodeMoved } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const surfaceHandle = (dispose: () => void): SurfaceHandle => ({
    dispose,
    elements: handle.elements,
    root: handle.root,
    scope: handle.scope,
  });
  if (options.signal?.aborted) {
    // The runtime already disposed it without attaching; there is no mount to record.
    return surfaceHandle(handle.dispose);
  }

  let id = 0;
  const dispose = (): void => {
    handle.dispose();
    unregisterMount(id);
  };
  id = registerMount({
    elements: handle.elements,
    host,
    name,
    remount: async () => {
      dispose();
      await mountSurface(name, hostScope, host, options);
    },
  });
  options.signal?.addEventListener("abort", () => unregisterMount(id), { once: true });
  return surfaceHandle(dispose);
}
