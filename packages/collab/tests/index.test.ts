import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { applyDocOpToDoc } from "@jxsuite/schema/doc-ops";
import * as collab from "../src/index.ts";
import { colorForKey } from "../src/awareness-types.ts";
import { diffDocs, replaceYStructure } from "../src/diff.ts";
import { decodeFrame, encodeFrame } from "../src/envelope.ts";
import { applyDocOpsToY, yEventsToDocOps } from "../src/op-bridge.ts";
import { seedStructure, yDocToJson } from "../src/schema.ts";

describe("package barrel", () => {
  test("exposes the schema, bridge, diff, envelope, and awareness surface", () => {
    // Identity, not just presence: the barrel must hand out the very functions its modules define.
    expect(collab.seedStructure).toBe(seedStructure);
    expect(collab.yDocToJson).toBe(yDocToJson);
    expect(collab.applyDocOpsToY).toBe(applyDocOpsToY);
    expect(collab.yEventsToDocOps).toBe(yEventsToDocOps);
    expect(collab.diffDocs).toBe(diffDocs);
    expect(collab.replaceYStructure).toBe(replaceYStructure);
    expect(collab.encodeFrame).toBe(encodeFrame);
    expect(collab.decodeFrame).toBe(decodeFrame);
    expect(collab.applyDocOpToDoc).toBe(applyDocOpToDoc);
    expect(collab.colorForKey).toBe(colorForKey);
    expect(collab.LOCAL_ORIGIN).toBe("jx-local");
    expect(collab.PRESENCE_PALETTE.length).toBeGreaterThan(0);
  });

  /**
   * The yjs re-exports, which are a CONTRACT rather than a convenience.
   *
   * Every consumer reaches yjs through this barrel so the whole app shares one instance — a second
   * one makes `instanceof` fail and, for the two position helpers below, makes every
   * `RelativePosition` a code-view cursor mints resolve to null against the document it came from.
   * The failure is a caret that silently stops moving, so it is worth a test that the entry points
   * exist at all.
   */
  test("re-exports the yjs surface consumers are required to use", () => {
    // The same yjs instance this package imports, which is the whole contract.
    expect(collab.YDoc).toBe(Y.Doc);
    expect(collab.UndoManager).toBe(Y.UndoManager);
    expect(collab.createRelativePositionFromTypeIndex).toBe(Y.createRelativePositionFromTypeIndex);
    expect(collab.createAbsolutePositionFromRelativePosition).toBe(
      Y.createAbsolutePositionFromRelativePosition,
    );
  });

  test("the position helpers round-trip an index through this instance", () => {
    const doc = new collab.YDoc();
    const text = collab.sourceText(doc);
    doc.transact(() => text.insert(0, "hello world"));
    const relative = collab.createRelativePositionFromTypeIndex(text, 6);
    doc.transact(() => text.insert(0, ">> "));
    const absolute = collab.createAbsolutePositionFromRelativePosition(relative, doc);
    // The position moved with the text it was anchored to, which is the whole point of it.
    expect(absolute?.index).toBe(9);
    expect(absolute?.type).toBe(text);
  });
});
