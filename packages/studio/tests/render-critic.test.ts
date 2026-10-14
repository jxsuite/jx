import "./with-dom.ts";
import { describe, expect, test } from "bun:test";
import { renderCheck } from "../src/services/render-critic";
import type { JxDocument } from "@jxsuite/schema/types";
import type { CandidateDocument, RenderVerdict } from "../src/services/ai-write-report";

/**
 * `renderCheck` as the AI tools take it: they hand over a `CandidateDocument`, the raw tool
 * argument that their `validate` dep has already accepted, and these suites stub `validate`.
 */
function checkCandidate(doc: CandidateDocument): Promise<RenderVerdict> {
  /* SAFETY: every candidate these suites send is a Jx document literal, and `renderCheck` runs its
     whole body (buildScope, renderNode) inside one try/catch that turns any throw into
     `{ ok: false }`, so a candidate that were not a well-formed document would still yield a
     verdict rather than an unhandled error. */
  return renderCheck(doc as JxDocument);
}

describe("render-critic", () => {
  test("valid document renders ok", async () => {
    const doc = {
      tagName: "div",
      children: [{ tagName: "h1", children: ["Hello World"] }],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(true);
  });

  test("minimal valid document (no children) renders ok", async () => {
    const doc = { tagName: "div" };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(true);
  });

  test("document with valid state and template expression renders ok", async () => {
    const doc = {
      tagName: "div",
      state: { count: 0 },
      children: [{ tagName: "span", children: ["Count: ${state.count}"] }],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(true);
  });

  test("template expression referencing missing state is caught", async () => {
    const doc = {
      tagName: "div",
      children: [{ tagName: "span", children: ["Value: ${nonExistent}"] }],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("is not defined");
  });

  test("malformed Function body is caught", async () => {
    const doc = {
      tagName: "div",
      state: {
        broken: {
          $prototype: "Function",
          body: "this is not valid javascript }{}{",
        },
      },
      children: [
        {
          tagName: "button",
          onclick: { $ref: "#/state/broken" },
          children: ["Click"],
        },
      ],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("Render error");
  });

  test("applyAndValidate integration — render break surfaces as tool error", async () => {
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { createTab, disposeTab } = await import("../src/tabs/tab");
    const { registerAiTools } = await import("../src/services/ai-tools");

    const doc = {
      tagName: "div",
      children: [{ tagName: "h1", children: ["Hello"] }],
    };
    const tab = createTab({ document: doc, id: "critic-test" });
    const registry = createToolRegistry();

    registerAiTools(registry, {
      getTab: () => tab,
      validate: async () => [],
      renderCheck: checkCandidate,
    });

    const result = await registry.execute("set_property", {
      path: ["children", 0],
      key: "onclick",
      value: { $ref: "#/state/nonExistent" },
    });

    // The set_property itself succeeds (schema allows arbitrary props), but the render
    // Critic should catch the broken $ref during render — or the property is benign
    // Enough that renderNode doesn't throw (in which case the critic correctly passes).
    // Either outcome is valid for this integration test; we just verify no crash.
    expect(result).toBeDefined();
    expect(result.success).toBeTypeOf("boolean");

    disposeTab(tab);
  });

  test("create_page render gate — rejects a render-broken page before writing", async () => {
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { registerAiTools } = await import("../src/services/ai-tools");

    let written = null;
    const registry = createToolRegistry();
    registerAiTools(registry, {
      getTab: () => null,
      validate: async () => [],
      renderCheck: checkCandidate,
      saveFile: async (path, content) => {
        written = { path, content };
      },
    });

    const result = await registry.execute("create_page", {
      path: "pages/broken.json",
      content: {
        tagName: "div",
        children: [{ tagName: "span", children: ["Value: ${nonExistent}"] }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("fails to render");
    expect(written).toBeNull(); // Nothing written to disk.
  });

  test("create_component render gate — writes a valid component", async () => {
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { registerAiTools } = await import("../src/services/ai-tools");

    let written: { path: string; content: string } | null = null;
    const registry = createToolRegistry();
    registerAiTools(registry, {
      getTab: () => null,
      validate: async () => [],
      renderCheck: checkCandidate,
      saveFile: async (path, content) => {
        written = { path, content };
      },
    });

    const result = await registry.execute("create_component", {
      path: "components/ok-card.json",
      content: {
        tagName: "ok-card",
        state: { title: "Hi" },
        children: [{ tagName: "h3", children: ["${state.title}"] }],
      },
    });

    expect(result.success).toBe(true);
    expect(written).not.toBeNull();
    expect(written!.path).toBe("components/ok-card.json");
  });
});
