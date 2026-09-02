/**
 * The kit's element documents, as bundled JSON. This is the whole authored surface of the kit:
 * every element is one of these files, interpreted by the runtime, and the canvas edits the same
 * bytes the shell runs.
 */
import type { JxDocument } from "@jxsuite/schema/types";
import jxIcon from "../components/jx-icon.json";

/** Tag name → document, in registration order (a document's `$elements` come before it). */
export const documents: Readonly<Record<string, JxDocument>> = {
  "jx-icon": jxIcon as unknown as JxDocument,
};

/** Every tag the kit defines. */
export const KIT_TAGS: readonly string[] = Object.keys(documents);
