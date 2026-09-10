/**
 * Tests for the `reference` form control (src/ui/form-controls.ts) and the dispatch that reaches it
 * (src/ui/schema-form.ts's `referenceTarget`).
 *
 * The control is registered ONCE and every form gets it, so these assertions are about the whole
 * §9.2 promise: a `$ref` to a collection is a picker in the entry editor, in a settings form and in
 * an array-of-objects row, without any of those three knowing the control exists.
 */
import { flush, pointer } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { html, render } from "lit-html";

let ids: string[] = ["ada", "grace"];
let listError = "";
let listCalls = 0;

void mock.module("../src/grid/sources/content-source", () => ({
  listCollectionEntryIds: async (name: string) => {
    listCalls += 1;
    if (listError) {
      throw new Error(listError);
    }
    return name === "authors" ? ids : [];
  },
}));

const { invalidateReferenceEntries } = await import("../src/ui/form-controls");
const { getFormControl, mountSchemaForm, resetSchemaForms } = await import("../src/ui/schema-form");
const { NULL_FORM_CONTEXT, referenceTarget } = await import("../src/ui/schema-form");

interface Mounted {
  container: HTMLElement;
  patches: Record<string, unknown>[];
  redraw: () => void;
}

/** Every container this file has attached, so one test's DOM never outlives it. */
const mounted: HTMLElement[] = [];
let mountSeq = 0;

/**
 * Mount one `author` field over a live value, repainting on the control's own rerender hook.
 *
 * The form is a document now, so the engine hands back the element it lives in and the mount is
 * asynchronous — the container is attached (a kit element renders on connect) and the caller awaits
 * before asserting. Each mount takes a key of its own, so two fields in one test are two forms.
 */
async function mountReference(value: unknown, schema: Record<string, unknown>): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  const patches: Record<string, unknown>[] = [];
  const state = { value };
  mountSeq += 1;
  const key = `reference:${mountSeq}`;
  const draw = () =>
    mountSchemaForm(
      key,
      { properties: { author: schema } },
      { author: state.value },
      {
        onChange: (patch) => {
          patches.push(patch);
          state.value = patch.author;
          draw();
        },
        rerender: () => {
          draw();
        },
      },
    );
  container.append(draw());
  await flush(6);
  return {
    container,
    patches,
    redraw: () => {
      draw();
    },
  };
}

/**
 * The control's FIRST frame, drawn on its own.
 *
 * A mounted document settles over several turns, so an assertion about what the control says before
 * its collection read comes back cannot be made through the form. This is the same control the form
 * dispatches to — `builtinFormControls` and `schema-form.test.ts` are what tie the two together.
 */
function firstFrame(schema: Record<string, unknown>, value: unknown): HTMLElement {
  const container = document.createElement("div");
  render(
    html`${getFormControl("reference")!({
      ctx: NULL_FORM_CONTEXT,
      key: "author",
      onChange: () => {
        /* Not committed here */
      },
      schema,
      value,
    })}`,
    container,
  );
  return container;
}

function picker(container: HTMLElement): HTMLElement | null {
  return container.querySelector("sp-picker.reference-field");
}

function choose(el: Element, value: string): void {
  (el as HTMLElement & { value: string }).value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  ids = ["ada", "grace"];
  listError = "";
  listCalls = 0;
  invalidateReferenceEntries();
  resetSchemaForms();
});

afterEach(() => {
  resetSchemaForms();
  for (const node of mounted.splice(0)) {
    node.remove();
  }
});

describe("referenceTarget", () => {
  test("names the collection a #/content pointer references, and nothing else", () => {
    expect(referenceTarget({ $ref: "#/content/authors" })).toBe("authors");
    expect(referenceTarget({ $ref: "#/state/authors" })).toBeNull();
    expect(referenceTarget({ $ref: "#/content/authors/extra" })).toBeNull();
    expect(referenceTarget({})).toBeNull();
    // A field with no schema at all — the inline path hands one through.
    const noSchema: { $ref?: string } | undefined = undefined;
    expect(referenceTarget(noSchema)).toBeNull();
  });
});

describe("the control", () => {
  test("says it is loading, then draws the collection's entries", async () => {
    expect(picker(firstFrame({ $ref: "#/content/authors" }, ""))?.getAttribute("label")).toBe(
      "Loading…",
    );
    const m = await mountReference("", { $ref: "#/content/authors" });
    await flush();
    const options = [...m.container.querySelectorAll("sp-menu-item")].map((o) => o.textContent);
    expect(options).toEqual(["—", "ada", "grace"]);
  });

  test("commits the chosen id, and clears to undefined", async () => {
    const m = await mountReference("", { $ref: "#/content/authors" });
    await flush();
    choose(picker(m.container)!, "grace");
    expect(m.patches.at(-1)).toEqual({ author: "grace" });
    await flush();
    choose(picker(m.container)!, "__none__");
    expect(m.patches.at(-1)).toEqual({ author: undefined });
  });

  test("keeps a dangling reference visible instead of blanking the field", async () => {
    const m = await mountReference("hopper", { $ref: "#/content/authors" });
    await flush();
    const missing = m.container.querySelector("sp-menu-item.reference-missing");
    expect(missing?.textContent).toBe("hopper — not found");
    expect(picker(m.container)?.getAttribute("value")).toBe("hopper");
  });

  test("an empty collection says so rather than presenting a blank dropdown", async () => {
    const m = await mountReference("", { $ref: "#/content/nobody" });
    await flush();
    expect(m.container.querySelector(".reference-note")?.textContent).toContain(
      "No nobody entries yet",
    );
  });

  test("a failed read stays editable, names the reason, and retries", async () => {
    listError = "EACCES";
    const m = await mountReference("ada", { $ref: "#/content/authors" });
    await flush();
    expect(m.container.querySelector(".reference-note--failed")?.textContent).toContain("EACCES");
    const field = m.container.querySelector("sp-textfield.reference-field") as HTMLElement & {
      value: string;
    };
    expect(field).not.toBeNull();
    field.value = "grace";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(m.patches.at(-1)).toEqual({ author: "grace" });

    listError = "";
    pointer(m.container.querySelector("sp-action-button")!, "click");
    await flush();
    expect(picker(m.container)).not.toBeNull();
  });

  test("reads a collection once and forgets it only when invalidated", async () => {
    await mountReference("", { $ref: "#/content/authors" });
    await flush();
    expect(listCalls).toBe(1);
    await mountReference("", { $ref: "#/content/authors" });
    await flush();
    expect(listCalls).toBe(1);
    invalidateReferenceEntries("authors");
    await mountReference("", { $ref: "#/content/authors" });
    await flush();
    expect(listCalls).toBe(2);
  });

  test("a `ui.control` override on a field that references nothing stays editable and says why", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    const patches: Record<string, unknown>[] = [];
    mountSeq += 1;
    container.append(
      mountSchemaForm(
        `reference:${mountSeq}`,
        { properties: { author: { type: "string" } } },
        { author: "ada" },
        {
          onChange: (patch) => patches.push(patch),
          ui: { author: { control: "reference" } },
        },
      ),
    );
    await flush(6);
    expect(container.querySelector(".reference-note")?.textContent).toContain(
      "No collection referenced",
    );
    const field = container.querySelector("sp-textfield.reference-field") as HTMLElement & {
      value: string;
    };
    field.value = "grace";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(patches.at(-1)).toEqual({ author: "grace" });
  });
});

describe("every consumer gets it without asking", () => {
  test("the frontmatter projection reaches the registry rather than its own ladder", async () => {
    /* This used to render `renderFmField`, a lit template with one host. Both frontmatter surfaces
       are documents now, so what they share is `projectFmField` — a PROJECTION rather than markup —
       and the contract it stands for is unchanged: a `$ref` to a collection is a picker over that
       collection's entry ids, not a text box you type an id into from memory. Where the picker's
       rows come from is `ui/form-controls.ts`'s read, which the tests above pin. */
    const { projectFmField } = await import("../src/panels/frontmatter-fields");
    const first = projectFmField("author", { $ref: "#/content/authors" }, "ada", new Set(), {
      rerender: () => {},
    });
    // The first ask starts the read, so it can only offer what it already holds.
    expect(first.row.kind).toBe("select");
    expect(first.row.options).toEqual([{ label: "Loading…", value: "ada" }]);
    await flush();

    const settled = projectFmField("author", { $ref: "#/content/authors" }, "ada", new Set(), {
      rerender: () => {},
    });
    expect(settled.row.options.map((o) => o.label)).toEqual(["—", "ada", "grace"]);
    expect(settled.row.value).toBe("ada");
    // And what a surface reads back off the control is the frontmatter value, empty meaning delete.
    expect(settled.parse("grace")).toBe("grace");
    expect(settled.parse("")).toBeUndefined();
  });

  test("a required field carries its marker, and a plain string field stays a text box", async () => {
    const { projectFmField } = await import("../src/panels/frontmatter-fields");
    const required = projectFmField("title", { type: "string" }, "", new Set(["title"]), {
      rerender: () => {},
    });
    expect(required.row.label).toBe("Title *");
    expect(required.row.kind).toBe("text");
    expect(required.row.isSet).toBe(false);
  });

  test("a settled collection renders synchronously — no Loading flash on every repaint", async () => {
    const first = await mountReference("", { $ref: "#/content/authors" });
    await flush();
    expect(picker(first.container)).not.toBeNull();
    /* A second field, drawn after the read settled, must not fall back to the placeholder: the
       enclosing form repaints on every keystroke in the field beside it. The first frame is what
       proves it — a settled collection renders from the cache with no await in between. */
    const settled = firstFrame({ $ref: "#/content/authors" }, "ada");
    expect(picker(settled)?.getAttribute("label")).not.toBe("Loading…");
    expect(settled.querySelectorAll("sp-menu-item")).toHaveLength(3);
  });

  test("a plain renderForm field dispatches on the schema alone", async () => {
    const m = await mountReference("", { $ref: "#/content/authors" });
    await flush();
    expect(picker(m.container)).not.toBeNull();
  });

  test("a cell inside an array-of-objects row dispatches too", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    const patches: Record<string, unknown>[] = [];
    mountSeq += 1;
    container.append(
      mountSchemaForm(
        `reference:${mountSeq}`,
        {
          properties: {
            credits: {
              items: { properties: { author: { $ref: "#/content/authors" } }, type: "object" },
              type: "array",
            },
          },
        },
        { credits: [{ author: "" }] },
        { onChange: (patch) => patches.push(patch) },
      ),
    );
    await flush(8);
    const inline = container.querySelector('[part="row"] sp-picker.reference-field');
    expect(inline).not.toBeNull();
    choose(inline!, "ada");
    expect(patches).toEqual([{ credits: [{ author: "ada" }] }]);
  });
});
