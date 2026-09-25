/**
 * The Jx document-op vocabulary, re-exported from its home in `@jxsuite/schema/doc-ops`.
 *
 * It moved so a host with no yjs (a Durable Object, a headless tool) can edit a document the way
 * Studio does. This subpath stays so every existing `@jxsuite/collab/ops` import keeps working.
 */

export {
  applyDocOpToDoc,
  applyDocOpsWithInverse,
  childArray,
  cloneValue,
  getNodeAtPath,
  inverseOf,
} from "@jxsuite/schema/doc-ops";
export type { JxDocOp, JxDocOpPair } from "@jxsuite/schema/doc-ops";
