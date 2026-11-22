/**
 * What each project component's Project Styles card is drawn with.
 *
 * The catalogue drew every component as a bare instance with only its declared defaults, and a
 * component is rarely drawable that way: the museum starter's `<mu-exhibition-card>` formats a
 * `date` that defaults to `""`, so its card stayed empty and the canvas logged "was not rendered:
 * RangeError: Invalid time value" for it on every paint (`spec.md` §16.4). The Site panel's
 * previews already know where a component's sample props live (`browse/component-examples.ts`: the
 * definition's own `examples`), so a card asks the same source and draws:
 *
 * - `props`: an instance given its sample props, when the definition renders with them;
 * - `bare`: the bare instance, when it renders with its defaults and has no sample props it renders
 *   with;
 * - `none`: no live instance at all (the catalogue's placeholder box), when it renders with neither,
 *   because an instance that throws draws nothing and reports an error nobody can fix.
 *
 * Nothing here reads the rest of the project, so a catalogue of N components costs N definition
 * reads and no usage queries.
 *
 * Answers are cached per component registry and, within it, per definition: by the tag and the hash
 * of the definition's bytes as the content store knows them (`project-state.md` §11.1), the host's
 * hash beside the newest write Studio made there whose echo has not arrived. A definition saved, or
 * rewritten on disk, changes that key without replacing the registry, so its card is asked again on
 * the next paint rather than keeping the sample the old bytes drew. Without a project state
 * subscription there is no hash, and a definition is asked once per registry, which is replaced
 * whenever the project's components are re-read.
 *
 * @docs studio/design/stylebook
 */

import { isNativeDocumentPath } from "@jxsuite/schema/jxn";
import { componentExampleProps } from "../browse/component-examples";
import { readDefinition, rendersWith } from "../preview-realm/ask";
import type { ComponentEntry } from "../files/components";
import { contentStore } from "../project-state/store";
import type { ContentStore } from "../project-state/store";
import type { JsonValue } from "@jxsuite/schema/types";

/** How one component card is drawn; see the module comment. */
export type StylebookSpecimen =
  | { kind: "props"; props: Record<string, JsonValue> }
  | { kind: "bare" }
  | { kind: "none" };

/** The specimens of the components a catalogue draws, by tag name. */
export type StylebookSpecimens = ReadonlyMap<string, StylebookSpecimen>;

/** One answer, and the definition key it was asked under. */
interface CachedSpecimen {
  readonly key: string;
  readonly answer: Promise<StylebookSpecimen>;
}

const cache = new WeakMap<readonly ComponentEntry[], Map<string, CachedSpecimen>>();

/** What the store reads a definition's key from: its hash and Studio's unechoed write. */
export type DefinitionHashes = Pick<ContentStore, "hashAt" | "pendingWriteAt">;

/**
 * The key a component's answer is cached under: its tag and the hash of its definition's bytes, or
 * the tag alone when the store knows no hash for them.
 */
export function definitionKey(component: ComponentEntry, hashes: DefinitionHashes): string {
  const { path, tagName } = component;
  if (path === undefined) {
    return tagName;
  }
  return `${tagName}\n${hashes.hashAt(path) ?? ""}\n${hashes.pendingWriteAt(path) ?? ""}`;
}

/** One component's specimen. A component that is not a project JSON definition is drawn bare. */
export async function componentSpecimen(component: ComponentEntry): Promise<StylebookSpecimen> {
  const { path } = component;
  if (component.source === "npm" || path === undefined || !isNativeDocumentPath(path)) {
    return { kind: "bare" };
  }
  const definition = await readDefinition(path);
  if (!definition) {
    return { kind: "bare" };
  }
  const props = componentExampleProps(definition);
  if (props.size > 0 && (await rendersWith(definition, path, props))) {
    return { kind: "props", props: Object.fromEntries(props) };
  }
  return (await rendersWith(definition, path, new Map())) ? { kind: "bare" } : { kind: "none" };
}

/**
 * The specimens of every component in `registry`, asked once per registry, component and definition
 * key ({@link definitionKey}). A component whose answer cannot be found is drawn bare, as it was
 * before specimens existed.
 */
export async function loadStylebookSpecimens(
  registry: readonly ComponentEntry[],
  ask: (component: ComponentEntry) => Promise<StylebookSpecimen> = componentSpecimen,
  hashes: DefinitionHashes = contentStore,
): Promise<StylebookSpecimens> {
  let answers = cache.get(registry);
  if (!answers) {
    answers = new Map();
    cache.set(registry, answers);
  }
  const known = answers;
  const entries = await Promise.all(
    registry.map(async (component): Promise<[string, StylebookSpecimen]> => {
      const slot = component.path ?? component.tagName;
      const key = definitionKey(component, hashes);
      let cached = known.get(slot);
      if (cached?.key !== key) {
        const entry: CachedSpecimen = {
          /* A question that found no answer (the preview realm went away mid-trial) is drawn bare
             for now and not remembered, so the next load asks it again. */
          answer: ask(component).catch((): StylebookSpecimen => {
            if (known.get(slot) === entry) {
              known.delete(slot);
            }
            return { kind: "bare" };
          }),
          key,
        };
        cached = entry;
        known.set(slot, entry);
      }
      return [component.tagName, await cached.answer];
    }),
  );
  return new Map(entries);
}
