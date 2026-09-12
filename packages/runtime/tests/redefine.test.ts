import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { defineElement, elementDefinition, preloadDocument, redefineElement } from "../src/runtime";

import type { JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

function badge(text: string, extra: Partial<JxDocument> = {}): JxDocument {
  return {
    tagName: "rd-badge",
    observedAttributes: ["label"],
    state: { label: "x" },
    textContent: `${text} \${state.label}`,
    ...extra,
  } as JxDocument;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("redefineElement", () => {
  test("a fresh instance renders the new definition; one already connected keeps the old", async () => {
    await defineElement(badge("v1"));
    const first = document.createElement("rd-badge");
    first.setAttribute("label", "a");
    document.body.append(first);
    await tick();
    expect(first.textContent).toBe("v1 a");
    expect(elementDefinition("rd-badge")?.doc.textContent).toBe("v1 ${state.label}");

    await redefineElement(badge("v2"));
    expect(elementDefinition("rd-badge")?.doc.textContent).toBe("v2 ${state.label}");
    // Still the v1 render, still live: the binding it rendered keeps following its state.
    first.setAttribute("label", "b");
    await tick();
    expect(first.textContent).toBe("v1 b");

    const second = document.createElement("rd-badge");
    second.setAttribute("label", "c");
    document.body.append(second);
    await tick();
    expect(second.textContent).toBe("v2 c");
    // And re-mounting the first is what moves it on.
    first.remove();
    const again = document.createElement("rd-badge");
    again.setAttribute("label", "d");
    document.body.append(again);
    await tick();
    expect(again.textContent).toBe("v2 d");
  });

  test("a tag not yet defined is defined, and a base is kept with the definition", async () => {
    await redefineElement(
      { tagName: "rd-fresh", textContent: "fresh" } as JxDocument,
      "jx-test:/x/",
    );
    expect(customElements.get("rd-fresh")).toBeDefined();
    expect(elementDefinition("rd-fresh")?.base).toBe("jx-test:/x/");
    await redefineElement(
      { tagName: "rd-fresh", textContent: "fresher" } as JxDocument,
      "jx-test:/y/",
    );
    expect(elementDefinition("rd-fresh")?.base).toBe("jx-test:/y/");
    const el = document.createElement("rd-fresh");
    document.body.append(el);
    await tick();
    expect(el.textContent).toBe("fresher");
  });

  test("a redefinition's $elements are registered, so a fresh instance renders its new dependency", async () => {
    // The replacement may lean on an element the first definition never named. `defineElement`
    // Registers a document's `$elements` on the way in; a redefinition reaches the registry without
    // It, so the dependency must be defined here, against the redefinition's own base, or the fresh
    // Instance renders `<rd-dep>` as an unknown element with nothing inside.
    await defineElement({ tagName: "rd-host", textContent: "v1" } as JxDocument);
    preloadDocument("jx-test:/deps/rd-dep.json", {
      tagName: "rd-dep",
      textContent: "dep",
    } as JxDocument);
    expect(customElements.get("rd-dep")).toBeUndefined();

    await redefineElement(
      {
        tagName: "rd-host",
        $elements: [{ $ref: "rd-dep.json" }],
        children: [{ tagName: "rd-dep" }],
      } as JxDocument,
      "jx-test:/deps/",
    );
    expect(customElements.get("rd-dep")).toBeDefined();

    const el = document.createElement("rd-host");
    document.body.append(el);
    await tick();
    await tick();
    expect(el.querySelector("rd-dep")?.textContent).toBe("dep");
  });

  test("a changed observedAttributes list is reported, because the platform freezes it", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => null);
    try {
      await defineElement(badge("v1"));
      await redefineElement(badge("v3", { observedAttributes: ["label", "tone"] }));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("observedAttributes");
      // The definition still moved on.
      expect(elementDefinition("rd-badge")?.doc.textContent).toBe("v3 ${state.label}");
    } finally {
      warn.mockRestore();
    }
  });

  test("a tag without a hyphen is refused", async () => {
    let message = "";
    try {
      await redefineElement({ tagName: "plain", textContent: "" } as JxDocument);
    } catch (error) {
      ({ message } = error as Error);
    }
    expect(message).toContain("must contain a hyphen");
  });

  test("an unknown tag has no definition", () => {
    expect(elementDefinition("rd-nothing")).toBeUndefined();
  });
});
