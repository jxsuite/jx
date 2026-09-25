/**
 * The UI kit at boot.
 *
 * `registerKit()` defines every `@jxsuite/ui` element in this realm from the JSON the bundle
 * carries and adopts the kit's theme into the document — no network, once. A surface awaits
 * {@link kitReady} before it mounts, so a document never renders a tag that is not yet defined.
 *
 * It is the only element registry Studio has. Adobe Spectrum Web Components registered beside it
 * through `ui/spectrum.ts` for the length of the migration, and the two families were held to one
 * palette by a brand fragment re-valued from the kit's ramp; both files are gone with the last lit
 * surface (specs/studio-ui-guidelines.md §9.3).
 *
 * @docs extending/ui-kit
 */
import { registerUi } from "@jxsuite/ui";

let ready: Promise<void> | null = null;

/**
 * Register the kit into a document, once.
 *
 * @param {Document} [doc] Default is the global document
 * @returns {Promise<void>} Settles when every element is defined
 */
export function registerKit(doc: Document = document): Promise<void> {
  ready ??= registerUi({ document: doc });
  return ready;
}

/** The registration promise, registering into the global document if nothing has yet. */
export function kitReady(): Promise<void> {
  return ready ?? registerKit();
}
