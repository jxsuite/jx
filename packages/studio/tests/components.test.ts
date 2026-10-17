import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildComponentInstance,
  componentRegistry,
  computeRelativePath,
  loadComponentRegistry,
  noteComponentSaved,
} from "../src/files/components";
import { installMockPlatform } from "./harness";
import { isString } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** An instance's element children, failing the test when the slot is a repeater or holds text. */
function elementChildren(instance: JxMutableNode): JxMutableNode[] {
  const { children } = instance;
  if (!Array.isArray(children)) {
    throw new TypeError("expected the instance to carry a children array");
  }
  return children.map((child) => {
    if (isString(child)) {
      throw new TypeError(`expected an element child, got text "${child}"`);
    }
    return child;
  });
}

// ─── buildComponentInstance ─────────────────────────────────────────────────

describe("buildComponentInstance", () => {
  test("no props, no slots — bare instance without children key", () => {
    const instance = buildComponentInstance({ tagName: "my-card" });
    expect(instance).toEqual({ $props: {}, tagName: "my-card" });
    expect("children" in instance).toBe(false);
  });

  test("prop defaults fill $props", () => {
    const instance = buildComponentInstance({
      props: [
        { default: "Hello", name: "title" },
        { name: "subtitle" }, // No default → empty string
      ],
      tagName: "my-card",
    });
    expect(instance.$props).toEqual({ subtitle: "", title: "Hello" });
  });

  test("slots without fallback inject no children", () => {
    const instance = buildComponentInstance({
      slots: [{ name: "" }, { name: "header" }],
      tagName: "my-card",
    });
    expect("children" in instance).toBe(false);
  });

  test("default-slot fallback is injected as-is", () => {
    const fallback = [{ tagName: "p", textContent: "Default" }, "loose text"];
    const instance = buildComponentInstance({
      slots: [{ fallback, name: "" }],
      tagName: "my-card",
    });
    expect(instance.children).toEqual(fallback);
  });

  test("named-slot element fallback gets a slot attribute", () => {
    const instance = buildComponentInstance({
      slots: [{ fallback: [{ tagName: "h2", textContent: "Title" }], name: "header" }],
      tagName: "my-card",
    });
    const child = elementChildren(instance)[0]!;
    expect(child.attributes).toEqual({ slot: "header" });
    expect(child.tagName).toBe("h2");
  });

  test("author-set slot attribute on fallback is preserved", () => {
    const instance = buildComponentInstance({
      slots: [
        {
          fallback: [{ attributes: { slot: "forwarded" }, tagName: "div" }],
          name: "header",
        },
      ],
      tagName: "my-card",
    });
    const child = elementChildren(instance)[0]!;
    expect(child.attributes).toEqual({ slot: "forwarded" });
  });

  test("string fallback in a named slot is wrapped in a span", () => {
    const instance = buildComponentInstance({
      slots: [{ fallback: ["Plain text"], name: "header" }],
      tagName: "my-card",
    });
    const child = elementChildren(instance)[0]!;
    expect(child).toEqual({
      attributes: { slot: "header" },
      children: ["Plain text"],
      tagName: "span",
    });
  });

  test("fallback children are cloned, not shared", () => {
    const fallback = [{ tagName: "p", textContent: "Default" }];
    const comp = { slots: [{ fallback, name: "" }], tagName: "my-card" };
    const a = buildComponentInstance(comp);
    const b = buildComponentInstance(comp);
    expect(a.children).not.toBe(b.children);
    expect(elementChildren(a)[0]).not.toBe(fallback[0]);
  });

  test("multiple slots combine fallback children in order", () => {
    const instance = buildComponentInstance({
      slots: [
        { fallback: [{ tagName: "h2", textContent: "Title" }], name: "header" },
        { fallback: [{ tagName: "p", textContent: "Body" }], name: "" },
      ],
      tagName: "my-card",
    });
    const children = elementChildren(instance);
    expect(children).toHaveLength(2);
    expect(children[0]!.attributes).toEqual({ slot: "header" });
    expect(children[1]!.attributes).toBeUndefined();
  });
});

// ─── computeRelativePath ────────────────────────────────────────────────────

describe("computeRelativePath", () => {
  test("same directory", () => {
    expect(computeRelativePath("pages/index.json", "pages/button.json")).toBe("./button.json");
  });

  test("child directory", () => {
    expect(computeRelativePath("pages/index.json", "pages/components/card.json")).toBe(
      "./components/card.json",
    );
  });

  test("parent directory", () => {
    expect(computeRelativePath("pages/about/index.json", "pages/button.json")).toBe(
      "../button.json",
    );
  });

  test("sibling directory", () => {
    expect(computeRelativePath("pages/about/index.json", "components/card.json")).toBe(
      "../../components/card.json",
    );
  });

  test("deeply nested to root", () => {
    expect(computeRelativePath("pages/a/b/c/index.json", "components/x.json")).toBe(
      "../../../../components/x.json",
    );
  });

  test("null fromDocPath returns ./ prefix", () => {
    expect(computeRelativePath(null, "components/button.json")).toBe("./components/button.json");
  });

  test("empty fromDocPath returns ./ prefix", () => {
    expect(computeRelativePath("", "components/button.json")).toBe("./components/button.json");
  });

  test("handles backslashes (Windows paths)", () => {
    expect(computeRelativePath(String.raw`pages\index.json`, String.raw`pages\button.json`)).toBe(
      "./button.json",
    );
  });

  test("common prefix is computed correctly", () => {
    expect(computeRelativePath("src/pages/home.json", "src/components/nav.json")).toBe(
      "../components/nav.json",
    );
  });
});

// ─── noteComponentSaved ─────────────────────────────────────────────────────

describe("noteComponentSaved", () => {
  const seed = async () => {
    installMockPlatform({
      discoverComponents: async () => [
        {
          $id: null,
          hasElements: false,
          path: "components/mas-service-card.json",
          props: [{ default: "", name: "imageSrc", type: "string" }],
          tagName: "mas-service-card",
        },
      ],
    });
    await loadComponentRegistry();
  };

  test("a saved definition rewrites its entry, so a prop's new format reaches the instances", async () => {
    await seed();
    const changed = noteComponentSaved("components/mas-service-card.json", {
      state: { imageSrc: { default: "", format: "image" }, title: "" },
      tagName: "mas-service-card",
    });
    expect(changed).toBe(true);
    expect(componentRegistry).toHaveLength(1);
    expect(componentRegistry[0]!.props).toEqual([
      { default: "", format: "image", name: "imageSrc" },
      { default: "", name: "title", type: "string" },
    ]);
  });

  test("a component saved for the first time joins the registry", async () => {
    await seed();
    expect(noteComponentSaved("components/mas-hero.json", { state: {}, tagName: "mas-hero" })).toBe(
      true,
    );
    expect(componentRegistry.map((c) => c.tagName)).toEqual(["mas-service-card", "mas-hero"]);
    expect(componentRegistry[1]!.path).toBe("components/mas-hero.json");
  });

  test("a page, an unsaved draft and a definition that is no longer a component", async () => {
    await seed();
    // A page has no hyphenated tagName and was never in the registry: nothing to do.
    expect(noteComponentSaved("pages/index.json", { children: [], tagName: "div" })).toBe(false);
    // A draft has no path a scan could have reported.
    expect(noteComponentSaved(null, { state: {}, tagName: "mas-hero" })).toBe(false);
    expect(componentRegistry).toHaveLength(1);
    // The definition lost its hyphen: the scan would drop it, so the registry does.
    expect(noteComponentSaved("components/mas-service-card.json", { tagName: "div" })).toBe(true);
    expect(componentRegistry).toEqual([]);
  });
});

describe("the bootstrap wires the registry into the save", () => {
  test("the saved-document listener calls noteComponentSaved and repaints its two readers", () => {
    const bootstrap = readFileSync(join(import.meta.dir, "../src/studio.ts"), "utf8");
    const listener = bootstrap.slice(bootstrap.indexOf("setDocumentSavedListener(("));
    const body = listener.slice(0, listener.indexOf("});") + 3);
    expect(body).toContain("noteComponentSaved(path, doc)");
    expect(body).toContain("renderPropertiesPanel();");
    expect(body).toContain("renderLeftPanel();");
  });
});

// ─── loadComponentRegistry ──────────────────────────────────────────────────

describe("loadComponentRegistry", () => {
  const entry = (tagName: string) => ({
    $id: null,
    hasElements: false,
    path: `components/${tagName}.json`,
    props: [],
    tagName,
  });
  type Entry = ReturnType<typeof entry>;

  /** A platform whose scans resolve only when the test releases them, in the order it chooses. */
  function heldScans(): ((value: Entry[]) => void)[] {
    const releases: ((value: Entry[]) => void)[] = [];
    installMockPlatform({
      discoverComponents: () =>
        new Promise<Entry[]>((resolve) => {
          releases.push(resolve);
        }),
    });
    return releases;
  }

  test("the newest scan wins when an older one resolves after it", async () => {
    const releases = heldScans();
    const older = loadComponentRegistry();
    const newer = loadComponentRegistry();
    releases[1]!([entry("new-card")]);
    await newer;
    releases[0]!([entry("old-card")]);
    await older;
    // The older scan read the project being closed: what it found must not land.
    expect(componentRegistry.map((comp) => comp.tagName)).toEqual(["new-card"]);
  });

  test("a superseded scan resolves only once the newest has written the registry", async () => {
    const releases = heldScans();
    let olderDone = false;
    const older = loadComponentRegistry().then(() => {
      olderDone = true;
    });
    const newer = loadComponentRegistry();
    releases[0]!([entry("old-card")]);
    await Bun.sleep(0);
    expect(olderDone).toBe(false);
    releases[1]!([entry("fresh-card")]);
    await Promise.all([older, newer]);
    expect(olderDone).toBe(true);
    expect(componentRegistry.map((comp) => comp.tagName)).toEqual(["fresh-card"]);
  });

  test("a failed scan leaves the registry as it was", async () => {
    installMockPlatform({ discoverComponents: async () => [entry("kept-card")] });
    await loadComponentRegistry();
    installMockPlatform({
      discoverComponents: async () => {
        throw new Error("backend down");
      },
    });
    await loadComponentRegistry();
    expect(componentRegistry.map((comp) => comp.tagName)).toEqual(["kept-card"]);
  });
});
