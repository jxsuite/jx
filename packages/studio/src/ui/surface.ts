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
import type { JxHostScope, JxMountOptions, JxScope } from "@jxsuite/runtime/types";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SelectRow } from "@jxsuite/ui/behaviors/select";
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

/**
 * One row a surface document draws in a picker (a `jx-select` option, a radio, a segmented button):
 * the value the control reports back, and the label the reader sees. The kit's own row, the one
 * `jx-select` draws.
 */
export type { SelectRow as SurfaceOption } from "@jxsuite/ui/behaviors/select";

/**
 * One thing a surface document draws for the reader to act on (an empty state's button, an openable
 * source): an id only the flow knows the meaning of, and the words on it.
 */
export interface SurfaceAction {
  id: string;
  label: string;
}

/** A delimited, labelled run of picker rows: the kit's `optgroup`, which draws both halves of it. */
export interface SurfaceOptionGroup {
  id: string;
  label: string;
  rows: SelectRow[];
}

/** A dialog document mounted into the dialog layer, as the flow that opened it holds it. */
export interface DialogLayerHandle {
  /** The slot in the dialog layer that carries the region. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** A label, and the key that identifies what it names (a chip, a section, a menu choice). */
export interface KeyedLabel {
  key: string;
  label: string;
}

/** A label, and the tag it stands for (a declared language, an element a button adds). */
export interface TaggedLabel {
  tag: string;
  label: string;
}

/** One tab a surface document draws in a tablist strip. */
export interface SurfaceTab {
  /** The tab's identity: the row key, the strip's `selected` value, and `data-tab`. */
  key: string;
  /** What the tab reads, badge included ("Problems 2"). */
  label: string;
  /** The tab element's own id, which the one panel names as its `aria-labelledby`. */
  tabId: string;
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
export async function mountSurface<S extends JxHostScope<S>>(
  name: string,
  hostScope: S,
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
  const mountOptions: JxMountOptions<S> = {
    scope: hostScope,
    base: SURFACES_BASE,
    resolver: surfaceResolver,
  };
  if (options.onNodeCreated) {
    mountOptions.onNodeCreated = options.onNodeCreated;
  }
  if (options.onNodeMoved) {
    mountOptions.onNodeMoved = options.onNodeMoved;
  }
  if (options.signal) {
    mountOptions.signal = options.signal;
  }
  const handle = await mount(doc, host, mountOptions);

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
