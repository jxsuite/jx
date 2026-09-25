/**
 * Every mounted surface document, by root.
 *
 * The shell holds many Jx roots at once — one per surface — and needs to answer two questions about
 * them that neither the runtime nor the DOM can: which roots render a given custom element (so a
 * redefinition can re-mount exactly those), and which roots came from a given surface document (so
 * a saved edit to that document re-mounts them). `mountSurface` registers here and unregisters on
 * dispose; nothing else writes.
 */

export interface SurfaceMount {
  readonly id: number;
  /** The surface name the document was registered under. */
  readonly name: string;
  readonly host: HTMLElement;
  /** Custom-element tags the render instantiated, as the runtime reported them. */
  readonly elements: ReadonlySet<string>;
  /** Dispose and mount again into the same host with the same scope. */
  readonly remount: () => Promise<void>;
}

const mounts = new Map<number, SurfaceMount>();
let nextId = 1;

/** Record a mount; returns the id `unregisterMount` takes. */
export function registerMount(entry: Omit<SurfaceMount, "id">): number {
  const id = nextId;
  nextId += 1;
  mounts.set(id, { ...entry, id });
  return id;
}

export function unregisterMount(id: number): void {
  mounts.delete(id);
}

/** Every live mount, in mount order. */
export function surfaceMounts(): SurfaceMount[] {
  return [...mounts.values()];
}

/** The mounts whose render instantiated `tag`. */
export function mountsUsing(tag: string): SurfaceMount[] {
  const lower = tag.toLowerCase();
  return surfaceMounts().filter((m) => m.elements.has(lower));
}

/** The mounts of one surface document. */
export function mountsOf(name: string): SurfaceMount[] {
  return surfaceMounts().filter((m) => m.name === name);
}

/** Forget every mount without disposing it — for tests. */
export function resetSurfaceRegistry(): void {
  mounts.clear();
}
