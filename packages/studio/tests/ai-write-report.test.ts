/**
 * The write verdict — `services/ai-write-report.ts`.
 *
 * Extracted from `ai-tools.ts`'s `applyAndValidate` so every document write the assistant makes,
 * hand-registered or projected from a command record, answers with the same three sentences. The
 * wording cases the hand tools already have stay in `ai-tools.test.ts`; these pin the two halves as
 * functions: what the snapshot reads, and what the verdict compares.
 */
import { resetWorkspaceWithTab } from "./harness";
import { describe, expect, test } from "bun:test";
import { toRaw } from "../src/reactivity";
import {
  reportDocumentWrite,
  snapshotBeforeWrite,
  translateValidationError,
} from "../src/services/ai-write-report";

describe("snapshotBeforeWrite", () => {
  test("reads the RAW document's errors and render state", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" } as never);
    const seen: unknown[] = [];
    const snapshot = await snapshotBeforeWrite(tab, {
      renderCheck: async (doc) => {
        seen.push(doc);
        return { error: "boom", ok: false };
      },
      validate: async (doc) => {
        seen.push(doc);
        return ["/a: bad", "/b: bad"];
      },
    });
    expect([...snapshot.errors]).toEqual(["/a: bad", "/b: bad"]);
    expect(snapshot.renderOk).toBe(false);
    // The raw object, not the reactive proxy: the validator walks the whole tree.
    expect(seen).toEqual([toRaw(tab.doc.document), toRaw(tab.doc.document)]);
  });

  test("with no render check, rendering counts as fine", async () => {
    const tab = resetWorkspaceWithTab();
    const snapshot = await snapshotBeforeWrite(tab, { validate: async () => [] });
    expect(snapshot).toEqual({ errors: new Set(), renderOk: true });
  });
});

describe("reportDocumentWrite", () => {
  test("only NEW schema errors are reported, each with a fix hint", async () => {
    const tab = resetWorkspaceWithTab();
    const before = { errors: new Set(["/old: must be string"]), renderOk: true };
    const result = await reportDocumentWrite(tab, before, "Did it.", {
      validate: async () => ["/old: must be string", "/tagName: must match pattern"],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("introduced schema errors");
    expect(result.error).toContain("/tagName: must match pattern");
    expect(result.error).toContain("→ Fix: Custom element tag names must contain a hyphen");
    expect(result.error).not.toContain("/old:");
  });

  test("the render check runs only when rendering worked before the write", async () => {
    const tab = resetWorkspaceWithTab();
    let checks = 0;
    const renderCheck = async () => {
      checks += 1;
      return { error: "render boom", ok: false } as const;
    };
    // Already broken before: this edit is not the culprit, and the check is not run.
    const wasBroken = await reportDocumentWrite(tab, { errors: new Set(), renderOk: false }, "s", {
      renderCheck,
      validate: async () => [],
    });
    expect(wasBroken).toEqual({ success: true, summary: "s" });
    expect(checks).toBe(0);
    // Fine before, broken after: reported.
    const broke = await reportDocumentWrite(tab, { errors: new Set(), renderOk: true }, "s", {
      renderCheck,
      validate: async () => [],
    });
    expect(broke.success).toBe(false);
    expect(broke.error).toContain("broke rendering");
    expect(broke.error).toContain("render boom");
    expect(checks).toBe(1);
  });

  test("a success carries the summary, plus the token hints when the project has tokens", async () => {
    const tab = resetWorkspaceWithTab({ style: { color: "#ff0000" }, tagName: "div" } as never);
    const before = { errors: new Set<string>(), renderOk: true };
    const plain = await reportDocumentWrite(tab, before, "Set the colour.", {
      validate: async () => [],
    });
    expect(plain).toEqual({ success: true, summary: "Set the colour." });
    const hinted = await reportDocumentWrite(tab, before, "Set the colour.", {
      getProjectStyle: () => ({ "--color-accent": "#ff0000" }),
      validate: async () => [],
    });
    expect(hinted.success).toBe(true);
    expect(hinted.summary).toStartWith("Set the colour.\n\n");
    expect(hinted.summary).toContain("--color-accent");
    // Tokens declared but none hard-coded: the plain sentence.
    const clean = await reportDocumentWrite(tab, before, "Set the colour.", {
      getProjectStyle: () => ({ "--color-accent": "#00ff00" }),
      validate: async () => [],
    });
    expect(clean).toEqual({ success: true, summary: "Set the colour." });
  });

  test("translateValidationError is the same function ai-tools.ts re-exports", async () => {
    const { translateValidationError: viaTools } = await import("../src/services/ai-tools");
    expect(viaTools).toBe(translateValidationError);
    expect(translateValidationError("/x: must be boolean")).toContain("Use true or false");
    expect(translateValidationError("/x: something else")).toBe("/x: something else");
  });
});
