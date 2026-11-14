/**
 * The kit's compiled distribution (ui.md §9), built and then run.
 *
 * `@jxsuite/ui` registers by interpreting its component documents, and every test in `packages/ui`
 * drives that path. This one builds `dist/` the way a release does (`buildCompiledKit`, into a
 * scratch directory) and loads its entry instead: no `registerUi`, no component document, no
 * interpreter. What it proves is that the kit's contract survives compilation: an element's
 * attributes and properties still reach its state, its host still carries what the definition
 * writes there, and its behaviour modules (`src/behaviors/*.ts`), which the build compiles into the
 * pack, still attach.
 *
 * The first import registers happy-dom and the kit's popover shim; nothing here may import the
 * kit's `src/index.ts`, which would define the same tags by interpretation.
 */
import "../packages/ui/tests/with-dom.ts";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { CemPackageOut } from "@jxsuite/schema/cem-manifest";

import { buildCompiledKit } from "./build-ui-dist.ts";
import type { CompiledKit } from "./build-ui-dist.ts";
import { documents } from "../packages/ui/src/documents.ts";

/* Under `.cache/`, which is ignored, and inside the repository, so the pack's two bare imports
   resolve from the root `node_modules` as a consumer's would from its own. */
const OUT = resolve(import.meta.dir, "../.cache/test-compiled-kit");

let kit: CompiledKit;

/** Let a microtask-queued hook (`onMount`) and the renders it causes settle. */
const settle = (): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, 5);
  });

/** A kit element, with the props a test reads off it. */
type KitElement = HTMLElement & { loading: boolean; selected: string; value: string };

function isKitElement(element: HTMLElement): element is KitElement {
  return "state" in element;
}

/** Create a kit element from markup, connect it, and wait for it to settle. */
async function mount(html: string): Promise<KitElement> {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  await settle();
  const el = host.firstElementChild;
  if (!(el instanceof HTMLElement) || !isKitElement(el)) {
    throw new Error(`Expected ${html} to upgrade to a compiled kit element`);
  }
  return el;
}

const part = <E extends HTMLElement = HTMLElement>(el: HTMLElement, name: string): E => {
  const found = el.querySelector<E>(`[part="${name}"]`);
  if (!found) {
    throw new Error(`Expected <${el.localName}> to render part "${name}"`);
  }
  return found;
};

beforeAll(async () => {
  kit = await buildCompiledKit(OUT);
  await import(resolve(OUT, "index.js"));
}, 60_000);

afterEach(() => {
  document.body.replaceChildren();
});

afterAll(() => {
  rmSync(OUT, { force: true, recursive: true });
});

describe("the compiled distribution", () => {
  test("holds a module and a manifest entry for every kit element", () => {
    const tags = Object.keys(documents).toSorted();
    expect(kit.tags.toSorted()).toEqual(tags);
    expect(kit.warnings).toEqual([]);
    for (const tag of tags) {
      expect(kit.files).toContain(`${tag}.js`);
      expect(customElements.get(tag)).toBeDefined();
    }
    for (const file of ["index.js", "elements.css", "theme.css", "custom-elements.json"]) {
      expect(existsSync(resolve(OUT, file))).toBe(true);
    }
    /* SAFETY: the file is the text the compiler wrote for a `CemPackageOut`. */
    const manifest = JSON.parse(
      readFileSync(resolve(OUT, "custom-elements.json"), "utf8"),
    ) as CemPackageOut;
    expect(manifest.modules.map((module) => module.declarations[0].tagName)).toEqual(tags);
    expect(manifest.modules.map((module) => module.path)).toEqual(
      tags.map((tag) => `dist/${tag}.js`),
    );
    const button = manifest.modules.find((module) => module.path === "dist/jx-button.js");
    expect(button?.declarations[0].attributes?.map((attribute) => attribute.name)).toContain(
      "variant",
    );
  });

  test("is JavaScript with two bare imports, and no behaviour left to transpile", () => {
    const modules = kit.files.filter((file) => file.endsWith(".js"));
    const specifiers = new Set<string>();
    for (const file of modules) {
      const source = readFileSync(resolve(OUT, file), "utf8");
      for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/gu)) {
        const [, specifier = ""] = match;
        if (!specifier.startsWith(".")) {
          specifiers.add(specifier.startsWith("lit-html/") ? "lit-html/*" : specifier);
        }
      }
      expect(source).not.toContain("jx-ui:/");
    }
    expect([...specifiers].toSorted()).toEqual(["@vue/reactivity", "lit-html", "lit-html/*"]);
  });

  test("its stylesheets carry each element's rules and the theme's layer", () => {
    const elements = readFileSync(resolve(OUT, "elements.css"), "utf8");
    expect(elements).toContain('jx-button[data-variant="accent"] > [part="control"]');
    expect(elements).toContain("jx-tabs {");
    expect(readFileSync(resolve(OUT, "theme.css"), "utf8")).toContain("@layer jx-ui");
  });
});

describe("a compiled jx-button", () => {
  test("takes its attributes into state and writes the host's own from them", async () => {
    const el = await mount('<jx-button variant="accent" size="lg">Save</jx-button>');
    expect(el.dataset.variant).toBe("accent");
    expect(el.dataset.size).toBe("lg");
    const control = part<HTMLButtonElement>(el, "control");
    expect(control.type).toBe("button");
    // The slotted text is inside the control, where the definition draws its slot.
    expect(part(el, "label").textContent.trim()).toBe("Save");

    el.setAttribute("disabled", "");
    expect(control.disabled).toBe(true);
    el.removeAttribute("disabled");
    expect(control.disabled).toBe(false);
    el.setAttribute("variant", "negative");
    expect(el.dataset.variant).toBe("negative");
  });

  test("a property set after connection reaches the inner control", async () => {
    const el = await mount("<jx-button>Save</jx-button>");
    const control = part(el, "control");
    expect(control.getAttribute("aria-busy")).toBeNull();
    el.loading = true;
    expect(control.getAttribute("aria-busy")).toBe("true");
    expect(el.dataset.loading).toBe("");
  });

  test("swallows a click while it is loading, on the control and at the host", async () => {
    const el = await mount("<jx-button>Save</jx-button>");
    let clicks = 0;
    el.addEventListener("click", () => {
      clicks += 1;
    });
    part(el, "control").click();
    expect(clicks).toBe(1);
    el.loading = true;
    part(el, "control").click();
    expect(clicks).toBe(1);
    // Dispatched at the host itself, the root handler is the one guard that sees it.
    const direct = new Event("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(direct);
    expect(direct.defaultPrevented).toBe(true);
  });

  test("its tooltip behaviour mints the id the hint is wired by", async () => {
    const el = await mount('<jx-button hint="Saves the page">Save</jx-button>');
    const control = part(el, "control");
    // `mintHintId` is the tooltip module's `onMount`: it ran, with the host.
    expect(control.id).toMatch(/^jx-button-\d+$/u);
    const tip = part(el, "tip");
    expect(tip.localName).toBe("jx-tooltip");
    expect(tip.id).toBe(`${control.id}-tip`);
    expect(control.getAttribute("aria-describedby")).toBe(tip.id);
    expect(part(el, "tip-text").textContent).toBe("Saves the page");
  });
});

describe("a compiled jx-textfield", () => {
  test("shows its value, follows the property, and hears what is typed", async () => {
    const el = await mount('<jx-textfield label="Name" value="Ada"></jx-textfield>');
    const input = part<HTMLInputElement>(el, "input");
    expect(input.value).toBe("Ada");
    el.value = "Grace";
    expect(input.value).toBe("Grace");
    input.value = "Linus";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el.value).toBe("Linus");
  });

  test("its clear button empties the field and says input then change", async () => {
    const el = await mount('<jx-textfield label="Search" clearable value="about"></jx-textfield>');
    const heard: string[] = [];
    for (const type of ["input", "change"]) {
      el.addEventListener(type, (event) => {
        heard.push(`${event.type}:${event.target === el ? "host" : "inner"}`);
      });
    }
    const clear = part<HTMLButtonElement>(el, "clear");
    expect(clear.getAttribute("aria-label")).toBe("Clear");
    // The behaviour module's guard: pressing the button must not blur the control.
    const pressed = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    clear.dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);
    clear.click();
    expect(el.value).toBe("");
    expect(heard).toEqual(["input:host", "change:host"]);
    await settle();
    // With nothing left to clear, the button goes.
    expect(el.querySelector('[part="clear"]')).toBeNull();
  });
});

describe("a compiled jx-tabs", () => {
  const strip =
    '<jx-tabs selected="design" label="Workspaces">' +
    '<jx-tab value="design" label="Design"></jx-tab>' +
    '<jx-tab value="content" label="Content"></jx-tab>' +
    '<jx-tab value="logic" label="Logic"></jx-tab></jx-tabs>';
  const rowsOf = (tabs: HTMLElement) => [...tabs.querySelectorAll<HTMLElement>("jx-tab")];
  const selections = (tabs: HTMLElement) =>
    rowsOf(tabs).map((row) => row.getAttribute("aria-selected"));
  const carets = (tabs: HTMLElement) => rowsOf(tabs).map((row) => row.getAttribute("tabindex"));

  test("names itself on the host and writes the selection onto its tabs", async () => {
    const tabs = await mount(strip);
    expect(tabs.getAttribute("role")).toBe("tablist");
    expect(tabs.getAttribute("aria-label")).toBe("Workspaces");
    // `applySelection`, from the tabs behaviour module, through the host's own binding.
    expect(tabs.dataset.selection).toBe("design");
    expect(selections(tabs)).toEqual(["true", "false", "false"]);
    expect(carets(tabs)).toEqual(["0", "-1", "-1"]);
    // Each tab is a compiled element too, and drew the label its attribute gave it.
    expect(rowsOf(tabs).map((row) => part(row, "label").textContent)).toEqual([
      "Design",
      "Content",
      "Logic",
    ]);
  });

  test("a click selects, writes selected before change, and the property follows", async () => {
    const tabs = await mount(strip);
    const changes: string[] = [];
    tabs.addEventListener("change", (event) => {
      changes.push(`${event instanceof CustomEvent ? String(event.detail) : ""}/${tabs.selected}`);
    });
    rowsOf(tabs)[2]?.click();
    expect(changes).toEqual(["logic/logic"]);
    expect(selections(tabs)).toEqual(["false", "false", "true"]);
    tabs.selected = "content";
    expect(selections(tabs)).toEqual(["false", "true", "false"]);
    // A host write is not a user's change.
    expect(changes).toHaveLength(1);
  });

  test("the arrows move the caret and, under auto activation, the selection", async () => {
    const tabs = await mount(strip);
    const rows = rowsOf(tabs);
    rows[0]?.focus();
    const press = (key: string) => {
      const active = document.activeElement;
      (active && tabs.contains(active) ? active : tabs).dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
    };
    press("ArrowRight");
    expect(tabs.selected).toBe("content");
    expect(carets(tabs)).toEqual(["-1", "0", "-1"]);
    press("End");
    expect(tabs.selected).toBe("logic");
    press("ArrowRight");
    expect(tabs.selected).toBe("design");
  });
});

describe("a compiled jx-menu", () => {
  test("is a menu of items, and an item's activation arrives as select", async () => {
    const menu = await mount(
      '<jx-menu label="Edit"><jx-menu-item value="copy">Copy</jx-menu-item>' +
        '<jx-menu-item value="paste" disabled>Paste</jx-menu-item></jx-menu>',
    );
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBe("Edit");
    const items = [...menu.querySelectorAll<HTMLElement>("jx-menu-item")];
    expect(items.map((item) => item.getAttribute("role"))).toEqual(["menuitem", "menuitem"]);
    expect(items.map((item) => item.getAttribute("aria-disabled"))).toEqual(["false", "true"]);
    const picked: string[] = [];
    menu.addEventListener("select", (event) => {
      picked.push(event instanceof CustomEvent ? String(event.detail) : "");
    });
    items[0]?.click();
    // A disabled row does not activate: the item's own root handler reads its state.
    items[1]?.click();
    expect(picked).toEqual(["copy"]);
  });
});
