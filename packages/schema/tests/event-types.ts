/**
 * The event types the type-check generators write (`spec.md` §23.3), spelled once for the tests of
 * every module that writes one.
 */

/** An event whose `target` is the element its handler is on. */
export const BOTH = "readonly currentTarget: T; readonly target: T";

/** An event that may have started on an element inside the one its handler is on. */
export const CURRENT = "readonly currentTarget: T";

/** The interfaces an event's type reads, declared so that a project without the DOM has them. */
export const EVENT_GLOBALS = [
  "declare global {",
  "  interface HTMLElementEventMap {}",
  "  interface HTMLElementTagNameMap {}",
  "  interface SVGElementTagNameMap {}",
  "}",
];

/**
 * The type of an event, as a lookup that answers `any` when it finds nothing.
 *
 * @param tag The element's tag, as a property name.
 * @param name The event's name, as a property name.
 * @param members What the element adds to the platform's event.
 * @param elements The interface the tag is read off.
 */
export function eventOn(
  tag: string,
  name: string,
  members: string,
  elements = "HTMLElementTagNameMap",
): string {
  return `(${elements} extends { ${tag}: infer T } ? HTMLElementEventMap extends { ${name}: infer E } ? E & { ${members} } : any : any)`;
}
