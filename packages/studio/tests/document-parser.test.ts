/** `canvas/document-parser.ts`: the `.jxn` reader both of Studio's realms hand the runtime. */
import { describe, expect, test } from "bun:test";
import { parseJxn } from "@jxsuite/schema/jxn";
import { parseDocumentText } from "../src/canvas/document-parser";

describe("parseDocumentText", () => {
  test("reads KDL text as the document parseJxn reads", async () => {
    const text = '/- kdl-version 2\n\nx-card {\n    p "Hello"\n}\n';
    expect(await parseDocumentText(text, "/components/x-card.jxn")).toEqual(
      parseJxn(text, "/components/x-card.jxn"),
    );
  });

  test("rejects text that does not parse, naming the source", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- Bun's expect().rejects is typed `void` but is a real Promise at runtime.
    await expect(parseDocumentText("x-broken {\n", "/components/x-broken.jxn")).rejects.toThrow();
  });
});
