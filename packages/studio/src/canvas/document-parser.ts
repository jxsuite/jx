/**
 * What reads a `.jxn` document handed over as its KDL text, in either of Studio's realms.
 *
 * Every Jx host answers a `.jxn` URL as JSON, so the runtime normally never calls this. It is the
 * runtime's fallback for a host that serves the file as it is (`setDocumentParser`), installed in
 * the canvas frame on every render and in Studio's own window before a component preview defines an
 * element, so neither realm fails on a host that answers the source.
 *
 * Loaded when one turns up, because the parser is a third of the canvas entry's size budget and
 * most documents never see a `.jxn` reference.
 */
import type { JxDocument } from "@jxsuite/schema/types";

/**
 * Parse a `.jxn` document's text.
 *
 * @param text The KDL source.
 * @param source Its URL, which names it in an error.
 */
export async function parseDocumentText(text: string, source: string): Promise<JxDocument> {
  const { parseJxn } = await import("@jxsuite/schema/jxn");
  return parseJxn(text, source);
}
