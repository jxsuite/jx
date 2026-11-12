/**
 * Where a component instance actually delivers a prop (studio.md §8.2.6).
 *
 * `$props` is not the only place a value lives. The property bridge (`compiler.md` §4.4) reads a
 * prop by several routes, and each of them renders while `$props` holds nothing, so a reader that
 * looks at `$props` alone reports the prop as unset. Two readers ask the question: the canvas's
 * prop-bound text, which refuses to edit a prop that lives elsewhere, and the Inspector's Component
 * Settings, which shows and edits the prop where it lives. One answer here keeps them agreeing.
 *
 * The routes, as the runtime and the site build apply them:
 *
 * 1. A **top-level key** on the instance node (`{ "tagName": "x-card", "heading": "Local" }`): the
 *    property-first interface written straight onto the node. `applyProperties` sets every
 *    non-reserved key as a JS property, and `connectedCallback` reads it back off `this`. Reserved
 *    keys (`name`, `items`, `children`, …) and `$`-prefixed keys never become DOM properties, so
 *    they deliver nothing.
 * 2. An **attribute named like a reflected DOM property** (`title`, `role`, `aria-label` for
 *    `ariaLabel`). Setting it writes the JS property as a side effect, which is the only way an
 *    attribute reaches the `key in this` merge `connectedCallback` runs; attribute names are
 *    case-insensitive. An attribute named like a prop that is NOT a DOM property (`ribbon`) writes
 *    no property and delivers nothing by this route. One the definition lists in
 *    `observedAttributes` is absorbed first and loses to every other route; Studio's component
 *    registry does not carry that list, so it is not modelled here.
 * 3. **`$props`**.
 * 4. The JSON shorthand **`attributes: { "props.<name>": "…" }`**. The runtime collects `props.*`
 *    attributes at connection; because `setAttribute` lowercases an HTML attribute name, the key it
 *    sees is the lowercased one, so `props.Label` delivers `label`. The site build lifts the key as
 *    written (`liftPropsAttributes`), so `props.cardLabel` delivers `cardLabel` there and nowhere
 *    else: a camelCase prop cannot be carried by the shorthand on a live page, which is why the
 *    authoring rules say the key must be lowercase.
 * 5. A **`data-jx-props`** payload, the build's own pre-rendered intake.
 *
 * The order is the order a value wins in, checked against the runtime by `prop-source.test.ts`. The
 * payload is read first and the shorthand after it; then every JS property the instance carries is
 * merged over both, and `$props`, a top-level key and a reflected attribute each arrive that way.
 * Among those three the last writer wins: an instance with a `$props` block assigns it, then its
 * attributes, then its top-level keys; one without applies its top-level keys before its
 * attributes, so there a reflected attribute beats a top-level key.
 *
 * @docs studio/design/properties
 */

import { RESERVED_KEYS, camelToKebab } from "@jxsuite/runtime";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/** The routes a prop can arrive by, named for what the document holds. */
export type PropRoute = "property" | "attribute" | "$props" | "props-attribute" | "payload";

/** One place an instance delivers a prop from. */
export interface PropSource {
  route: PropRoute;
  /**
   * The key that holds the value: the attribute's own name for the two attribute routes (as
   * written, so a write goes back to the same key), and the prop's name for the other three.
   */
  key: string;
  value: JxDocumentValue;
}

/** The attribute the site build writes its pre-rendered props payload into. */
export const PAYLOAD_ATTRIBUTE = "data-jx-props";

const SHORTHAND_PREFIX = "props.";

/** The prop a `props.*` attribute names, before any case folding, or null for any other name. */
function shorthandName(attr: string): string | null {
  return attr.startsWith(SHORTHAND_PREFIX) && attr.length > SHORTHAND_PREFIX.length
    ? attr.slice(SHORTHAND_PREFIX.length)
    : null;
}

/**
 * Whether the `props.*` attribute `attr` delivers `prop`: as the site build reads it (the key as
 * written) or as the runtime reads it (the key lowercased).
 */
export function shorthandDelivers(attr: string, prop: string): boolean {
  const name = shorthandName(attr);
  return name !== null && (name === prop || name.toLowerCase() === prop);
}

/**
 * Whether `prop` is a property every element already has, so that an attribute of that name reaches
 * it. This is the runtime's own test (`key in this`, asked of the instance in `connectedCallback`),
 * asked of the realm Studio runs in. Without a DOM nothing is reflected.
 */
export function reflectedProperty(prop: string): boolean {
  return typeof HTMLElement !== "undefined" && prop in HTMLElement.prototype;
}

/**
 * Whether the attribute `attr` delivers `prop` by reflection: `prop` is a DOM property (see
 * {@link reflectedProperty}), and `attr` names it the way `instanceSupplies` matches,
 * case-insensitively or by the kebab spelling an ARIA-style reflection carries for a camelCase
 * property. The shorthand and the payload are routes of their own and never count here.
 */
export function attributeNamesProp(attr: string, prop: string): boolean {
  if (shorthandName(attr) !== null || attr === PAYLOAD_ATTRIBUTE || !reflectedProperty(prop)) {
    return false;
  }
  const lower = attr.toLowerCase();
  return lower === prop.toLowerCase() || lower === camelToKebab(prop).toLowerCase();
}

/** A `data-jx-props` payload as the object it encodes, or null when it is absent or not one. */
export function payloadOf(node?: JxMutableNode): Record<string, JsonValue> | null {
  const raw = node?.attributes?.[PAYLOAD_ATTRIBUTE];
  if (!isString(raw)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Every place `node` delivers `prop` from, the value that wins first.
 *
 * Two of anything is a conflict the document already holds; the list says so rather than hiding the
 * value that does not win, so a writer can tell.
 */
export function propSources(node: JxMutableNode | undefined, prop: string): PropSource[] {
  if (!node) {
    return [];
  }
  const attrs = node.attributes ?? {};
  const names = Object.keys(attrs).filter((name) => attrs[name] !== undefined);
  // `$`-prefixed keys are scope bindings, never DOM properties; `applyProperties` skips them too.
  const property: PropSource[] =
    !RESERVED_KEYS.has(prop) && !prop.startsWith("$") && node[prop] !== undefined
      ? [{ key: prop, route: "property", value: node[prop] }]
      : [];
  const attribute = names
    .filter((name) => attributeNamesProp(name, prop))
    .map((name): PropSource => ({ key: name, route: "attribute", value: attrs[name]! }));
  // Which of the two is written last depends on whether the instance carries a `$props` block.
  const sources: PropSource[] = node.$props
    ? [...property, ...attribute]
    : [...attribute, ...property];
  const own = node.$props?.[prop];
  if (own !== undefined) {
    sources.push({ key: prop, route: "$props", value: own });
  }
  // The exact spelling first: it is the one both the build and the runtime read.
  const shorthand = names
    .filter((name) => shorthandDelivers(name, prop))
    .toSorted((a, b) => Number(shorthandName(b) === prop) - Number(shorthandName(a) === prop));
  for (const name of shorthand) {
    sources.push({ key: name, route: "props-attribute", value: attrs[name]! });
  }
  const payload = payloadOf(node);
  if (payload && Object.hasOwn(payload, prop)) {
    sources.push({ key: prop, route: "payload", value: payload[prop]! });
  }
  return sources;
}

/** The place `node` delivers `prop` from, or null when nothing on the instance supplies it. */
export function propSource(node: JxMutableNode | undefined, prop: string): PropSource | null {
  return propSources(node, prop)[0] ?? null;
}

/**
 * Whether the instance node delivers `prop` by some route OTHER than `$props`, in which case
 * "absent from `$props`" does not mean "unset", and a `$props` write would add a SECOND source for
 * one rendered value (studio.md §8.2.6). The canvas refuses an inline edit then, and leaves the
 * value to the properties panel, which edits the real source.
 */
export function deliveredOutsideProps(node: JxMutableNode | undefined, prop: string): boolean {
  return propSources(node, prop).some((source) => source.route !== "$props");
}

/**
 * Whether the `props.*` shorthand can carry `value` for `prop` on a live page: a string with no
 * `${` in it (a template in an attribute is a binding, and the runtime reads a `props.*` attribute
 * once, at connection) for a prop whose name is already lowercase. Anything else belongs in
 * `$props`, as the authoring rules say.
 */
export function shorthandCarries(prop: string, value: JsonValue | undefined): boolean {
  return isString(value) && !value.includes("${") && prop === prop.toLowerCase();
}

/** The words a chip uses for a source that is not `$props`, after "Set by". */
export function describePropSource(source: PropSource): string {
  switch (source.route) {
    case "property": {
      return `the instance's ${source.key} property`;
    }
    case "attribute":
    case "props-attribute": {
      return `the ${source.key} attribute`;
    }
    case "payload": {
      return `the ${PAYLOAD_ATTRIBUTE} payload`;
    }
    default: {
      return "$props";
    }
  }
}
