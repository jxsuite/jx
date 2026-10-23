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
 * Answers are cached per component registry: the registry is replaced whenever the project's
 * components are re-read, so a changed definition is asked again.
 *
 * @docs studio/design/stylebook
 */

import { componentExampleProps } from "../browse/component-examples";
import { readDefinition, rendersWith } from "../browse/library-preview";
import type { ComponentEntry } from "../files/components";
import type { JsonValue } from "@jxsuite/schema/types";

/** How one component card is drawn; see the module comment. */
export type StylebookSpecimen =
  | { kind: "props"; props: Record<string, JsonValue> }
  | { kind: "bare" }
  | { kind: "none" };

/** The specimens of the components a catalogue draws, by tag name. */
export type StylebookSpecimens = ReadonlyMap<string, StylebookSpecimen>;

const cache = new WeakMap<readonly ComponentEntry[], Map<string, Promise<StylebookSpecimen>>>();

/** One component's specimen. A component that is not a project JSON definition is drawn bare. */
export async function componentSpecimen(component: ComponentEntry): Promise<StylebookSpecimen> {
  const { path } = component;
  if (component.source === "npm" || !path?.endsWith(".json")) {
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
 * The specimens of every component in `registry`, asked once per registry and component. A
 * component whose answer cannot be found is drawn bare, as it was before specimens existed.
 */
export async function loadStylebookSpecimens(
  registry: readonly ComponentEntry[],
  ask: (component: ComponentEntry) => Promise<StylebookSpecimen> = componentSpecimen,
): Promise<StylebookSpecimens> {
  let answers = cache.get(registry);
  if (!answers) {
    answers = new Map();
    cache.set(registry, answers);
  }
  const known = answers;
  const entries = await Promise.all(
    registry.map(async (component): Promise<[string, StylebookSpecimen]> => {
      const key = component.path ?? component.tagName;
      let answer = known.get(key);
      if (!answer) {
        answer = ask(component).catch((): StylebookSpecimen => ({ kind: "bare" }));
        known.set(key, answer);
      }
      return [component.tagName, await answer];
    }),
  );
  return new Map(entries);
}
