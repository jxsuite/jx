/**
 * The frame's half of a document's own scripts on the canvas (`spec.md` §23.2, `studio.md` §4.1).
 *
 * A render's documents arrive with every `$src` naming its own script already qualified and with no
 * `$script` (`canvas-scripts.ts`), so the runtime in this realm never sees the text a specifier
 * names. Each client script arrives beside them instead, and is registered here the way a host
 * registers any module it has in hand: under its specifier, loaded when a document first names it.
 *
 * A script is registered again only when its text is not the text this frame last registered. The
 * same text keeps the module it made, with whatever that module's top level set up, across every
 * render of an unchanged script.
 *
 * @docs framework/concepts/functions
 */
import type { BodyEraserModule } from "@jxsuite/runtime";
import type { JxScope } from "@jxsuite/runtime/types";

/** What the frame's realm gives: the runtime's registration, the eraser, and where packages are. */
export interface ScriptHost {
  /** `loadBodyEraser`: fetches `@jxsuite/erase/browser`, which carries the module loader. */
  loadEraser: () => Promise<BodyEraserModule>;
  /** `preloadModule` from the runtime of this realm. */
  preload: (specifier: string, load: () => Promise<JxScope>) => void;
  /** Where the host serves a package, as given to `setNpmModuleResolver`. */
  resolveNpm: (specifier: string) => string;
}

/**
 * What a render handler calls with the scripts its message carried, before it draws anything.
 *
 * @param host The realm's runtime and loader.
 */
export function scriptAdopter(
  host: ScriptHost,
): (scripts?: Readonly<Record<string, string>>) => void {
  /** The text each specifier was last registered with. */
  const given = new Map<string, string>();
  return (scripts) => {
    for (const [specifier, text] of Object.entries(scripts ?? {})) {
      if (given.get(specifier) === text) {
        continue;
      }
      given.set(specifier, text);
      host.preload(specifier, async () => {
        const { loadModule } = await host.loadEraser();
        if (!loadModule) {
          throw new Error(
            `Jx: ${specifier} is a document's script, and this canvas was built with an eraser ` +
              `that cannot load one`,
          );
        }
        const module = await loadModule(specifier, { resolveNpm: host.resolveNpm, text });
        /* SAFETY: trust boundary, the one the runtime's own import crosses: the loader hands back
           the namespace `import()` gave it, which the runtime reads by export name and checks at
           each use. */
        return module as JxScope;
      });
    }
  };
}
