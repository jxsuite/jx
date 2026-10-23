/**
 * What a component's live preview is drawn with.
 *
 * A preview instance used to be given nothing, so it drew its definition's DEFAULTS, and a starter
 * component's defaults are empty strings: a page header with no title, a band with no label, a card
 * with no name. The definition's own `examples` fill that gap: the JSON Schema keyword a typed
 * state entry may carry (`spec.md` §5.3, Shape 2), whose first value is the author's own sample.
 * Only a prop that is not private (`spec.md` §5.6), and whose sample is literal data, is taken.
 *
 * The preview never looks further than the definition. It once borrowed props from the component's
 * first use in the project, and drew a component used only as a list row as that list's first row,
 * both found through the reference index; that cost one project-wide usage query per component on
 * every Library and Project Styles paint, which on a hosted project was enough requests at once to
 * reset the session. A batched or on-demand source may bring it back.
 *
 * @docs studio/interface
 */

import { isJsonObject, isPrivateStateKey, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxDocument, JxDocumentValue } from "@jxsuite/schema/types";

/** A component's sample props, by state key. */
export type ExampleProps = Map<string, JsonValue>;

/** Whether a value is plain data a prop can hold outside any page: no template, no binding. */
export function isLiteralProp(value: JxDocumentValue | undefined): value is JsonValue {
  if (value === undefined) {
    return false;
  }
  if (isString(value)) {
    return !value.includes("${");
  }
  if (Array.isArray(value)) {
    return value.every((member) => isLiteralProp(member));
  }
  if (isJsonObject(value)) {
    return (
      !("$ref" in value) &&
      !("$prototype" in value) &&
      !("$expression" in value) &&
      Object.values(value).every((member) => isLiteralProp(member))
    );
  }
  return true;
}

/**
 * The props a component's preview instance is given: the first `examples` value of each public
 * typed state entry that declares a literal one.
 */
export function componentExampleProps(definition: JxDocument): ExampleProps {
  const out: ExampleProps = new Map();
  for (const [key, entry] of Object.entries(definition.state ?? {})) {
    if (isPrivateStateKey(key) || !isJsonObject(entry) || !Array.isArray(entry.examples)) {
      continue;
    }
    const [first] = entry.examples;
    if (isLiteralProp(first)) {
      out.set(key, first);
    }
  }
  return out;
}
