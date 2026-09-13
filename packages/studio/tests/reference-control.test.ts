/**
 * Tests for the `reference` form control (src/ui/form-controls.ts,
 * src/surfaces/reference-field.json) and the dispatch that reaches it (src/ui/schema-form.ts's
 * `referenceTarget`).
 *
 * The control is registered ONCE and every form gets it, so these assertions are about the whole
 * §9.2 promise: a `$ref` to a collection is a picker in the entry editor, in a settings form and in
 * an array-of-objects row, without any of those three knowing the control exists.
 *
 * **It is a Jx document now**, mounted into the empty `[part="control-host"]` the form's own
 * document announces, so four things about this file are deliberate rather than incidental:
 *
 * - Everything is addressed by `part`. There is no `sp-picker.reference-field` and no
 *   `sp-menu-item.reference-missing` to find: the dangling entry says what it is in its LABEL,
 *   which is the channel a reader who cannot see red still gets.
 * - Every container is APPENDED to the page and every mount awaited — a kit element renders in its
 *   `connectedCallback`, so a detached host holds tags with nothing inside them.
 * - An edit is made on the NATIVE control inside the kit element, never on the element: the kit hears
 *   its own control's event and lets it bubble.
 * - The collection read is GATED by the test rather than raced. A mounted control's first frame is
 *   only observable once the document has rendered, which is several turns after the read starts —
 *   so "Loading…" is asserted by holding the read open, not by rendering a template by hand.
 */
import { flush, pointer } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let ids: string[] = ["ada", "grace"];
let listError = "";
let listCalls = 0;
/** While true, every read parks until its gate is opened: the "Loading…" state, held open. */
let hold = false;
/** One opener per parked read, in the order the reads started. */
const gates: (() => void)[] = [];

void mock.module("../src/grid/sources/content-source", () => ({
  listCollectionEntryIds: async (name: string) => {
    listCalls += 1;
    /* Snapshotted BEFORE the park, so two reads of the same collection can answer differently —
       which is what tells a stale read's answer apart from the one that replaced it. */
    const answer = name === "authors" ? [...ids] : [];
    if (hold) {
      await new Promise<void>((resolve) => {
        gates.push(resolve);
      });
    }
    if (listError) {
      throw new Error(listError);
    }
    return answer;
  },
}));

const { invalidateReferenceEntries, referenceControl } = await import("../src/ui/form-controls");
const { mountSchemaForm, resetSchemaForms } = await import("../src/ui/schema-form");
const { NULL_FORM_CONTEXT, referenceTarget } = await import("../src/ui/schema-form");

interface Mounted {
  container: HTMLElement;
  patches: Record<string, unknown>[];
  redraw: () => void;
}

/** Every container this file has attached, so one test's DOM never outlives it. */
const mounted: HTMLElement[] = [];
let mountSeq = 0;

/** Let the form, the control it mounts and the kit elements inside it all catch up. */
async function settle(): Promise<void> {
  await flush(8);
}

/** Open every parked read and let the answers reach the controls. */
async function land(): Promise<void> {
  for (const open of gates.splice(0)) {
    open();
  }
  await settle();
}

/**
 * Mount one `author` field over a live value, repainting on the control's own rerender hook.
 *
 * The form is a document, so the engine hands back the element it lives in and the mount is
 * asynchronous — the container is attached and the caller awaits before asserting. Each mount takes
 * a key of its own, so two fields in one test are two forms.
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
  await settle();
  return {
    container,
    patches,
    redraw: () => {
      draw();
    },
  };
}

/** The picker the control drew, or null when it drew the text field instead. */
function picker(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[part="reference"] [part="picker"]');
}

/** The text field the control drew — the failed and unreferenced states. */
function textField(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[part="reference"] [part="text"]');
}

/** The sentence under the control, if it drew one. */
function note(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[part="reference"] [part="note"]');
}

/** The native control a kit element wraps: the field's input, or the picker's select. */
function control(el: Element): HTMLInputElement {
  const inner = el.querySelector<HTMLInputElement>('input[part="input"], select[part="control"]');
  if (!inner) {
    throw new Error(`no native control inside <${el.tagName.toLowerCase()}>`);
  }
  return inner;
}

/** The row labels a picker is offering, in order. */
function optionLabels(root: ParentNode): (string | null)[] {
  return [...root.querySelectorAll('[part="picker"] option [part="text"]')].map(
    (text) => text.textContent,
  );
}

/** Pick a row, the way a reader does. */
function choose(el: Element, value: string): void {
  const inner = control(el);
  inner.value = value;
  inner.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Type into a field and commit it, the way a reader does. */
function type(el: Element, value: string): void {
  const inner = control(el);
  inner.value = value;
  inner.dispatchEvent(new Event("input", { bubbles: true }));
  inner.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  ids = ["ada", "grace"];
  listError = "";
  listCalls = 0;
  hold = false;
  gates.length = 0;
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
    hold = true;
    const m = await mountReference("", { $ref: "#/content/authors" });
    /* A disabled picker whose one row says so. The row is not decoration: a select shows the
       SELECTED option's text, so a picker with no rows would sit there looking empty and enabled. */
    expect(control(picker(m.container)!).disabled).toBe(true);
    expect(optionLabels(m.container)).toEqual(["Loading…"]);

    await land();
    expect(control(picker(m.container)!).disabled).toBe(false);
    expect(optionLabels(m.container)).toEqual(["—", "ada", "grace"]);
  });

  test("commits the chosen id, and clears to undefined", async () => {
    const m = await mountReference("", { $ref: "#/content/authors" });
    await settle();
    choose(picker(m.container)!, "grace");
    expect(m.patches.at(-1)).toEqual({ author: "grace" });
    await settle();
    /* The empty row is `""` rather than a sentinel — the kit's select treats the empty string as a
       value a reader can arrow to — and what it MEANS is the flow's answer: delete the key. */
    choose(picker(m.container)!, "");
    expect(m.patches.at(-1)).toEqual({ author: undefined });
  });

  test("keeps a dangling reference visible instead of blanking the field", async () => {
    const m = await mountReference("hopper", { $ref: "#/content/authors" });
    await settle();
    /* The old control coloured this row red and left the text bare. Colour is not a channel every
       reader has, so the fact lives in the label now: the row SAYS the entry is not there. */
    expect(optionLabels(m.container)).toEqual(["—", "hopper — not found", "ada", "grace"]);
    expect(control(picker(m.container)!).value).toBe("hopper");
  });

  test("an empty collection says so rather than presenting a blank dropdown", async () => {
    const m = await mountReference("", { $ref: "#/content/nobody" });
    await settle();
    expect(note(m.container)?.textContent).toContain("No nobody entries yet");
    expect(note(m.container)?.dataset["tone"]).toBe("dim");
  });

  test("a failed read stays editable, names the reason, and retries", async () => {
    listError = "EACCES";
    const m = await mountReference("ada", { $ref: "#/content/authors" });
    await settle();
    expect(picker(m.container)).toBeNull();
    expect(note(m.container)?.textContent).toContain("EACCES");
    // A fault rather than a fact about the project, and the note says which it is.
    expect(note(m.container)?.dataset["tone"]).toBe("danger");

    const field = textField(m.container);
    expect(field).not.toBeNull();
    type(field!, "grace");
    expect(m.patches.at(-1)).toEqual({ author: "grace" });

    listError = "";
    pointer(m.container.querySelector('[part="retry"]')!, "click");
    await settle();
    expect(picker(m.container)).not.toBeNull();
    expect(note(m.container)).toBeNull();
  });

  /**
   * Retry used to be offered only where the HOST had passed a repaint hook, because a template
   * control cannot draw a second frame of its own. A mounted control can, so the button is now on
   * offer wherever the listing failed — including in a host that never comes back.
   */
  test("a host that passes no rerender hook still gets a working Retry", async () => {
    listError = "EACCES";
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    mountSeq += 1;
    container.append(
      mountSchemaForm(
        `reference:${mountSeq}`,
        { properties: { author: { $ref: "#/content/authors" } } },
        { author: "ada" },
        {
          onChange: () => {
            /* Not committed here */
          },
        },
      ),
    );
    await settle();
    const retry = container.querySelector('[part="retry"]');
    expect(retry).not.toBeNull();

    listError = "";
    pointer(retry!, "click");
    await settle();
    expect(picker(container)).not.toBeNull();
  });

  test("reads a collection once and forgets it only when invalidated", async () => {
    await mountReference("", { $ref: "#/content/authors" });
    await settle();
    expect(listCalls).toBe(1);
    await mountReference("", { $ref: "#/content/authors" });
    await settle();
    expect(listCalls).toBe(1);
    invalidateReferenceEntries("authors");
    await mountReference("", { $ref: "#/content/authors" });
    await settle();
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
    await settle();
    expect(note(container)?.textContent).toContain("No collection referenced");
    // Nothing to try again: the declaration is incomplete, not the read.
    expect(container.querySelector('[part="retry"]')).toBeNull();
    type(textField(container)!, "grace");
    expect(patches.at(-1)).toEqual({ author: "grace" });
  });

  /**
   * The control is mounted directly, the way the engine does it, so the handle's own contract is
   * asserted rather than only its behaviour through a form.
   */
  test("the standing mount is updated with the host's new value, and disposed with the field", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const handle = referenceControl.mount(host, {
      ctx: NULL_FORM_CONTEXT,
      key: "author",
      onChange: () => {
        /* Not committed here */
      },
      schema: { $ref: "#/content/authors" },
      value: "ada",
    });
    await settle();
    const drawn = picker(host);
    expect(control(drawn!).value).toBe("ada");

    handle.update({
      ctx: NULL_FORM_CONTEXT,
      key: "author",
      onChange: () => {
        /* Not committed here */
      },
      schema: { $ref: "#/content/authors" },
      value: "grace",
    });
    await settle();
    // The SAME control moved: a rebuilt one would take the dropdown out from under a reader.
    expect(picker(host)).toBe(drawn);
    expect(control(drawn!).value).toBe("grace");

    handle.dispose();
    await settle();
    expect(host.childNodes.length).toBe(0);
  });

  /** Disposing before the mount has settled must not leave a document running in a detached host. */
  test("dispose during the mount takes down the surface that arrives after it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const handle = referenceControl.mount(host, {
      ctx: NULL_FORM_CONTEXT,
      key: "author",
      onChange: () => {
        /* Not committed here */
      },
      schema: { $ref: "#/content/authors" },
      value: "",
    });
    handle.dispose();
    await settle();
    expect(host.childNodes.length).toBe(0);
  });

  /**
   * A host the document has been taken out of — the form's own repaint replacing the control host,
   * or a caller emptying it — is the one case an assignment to the scope cannot answer.
   */
  test("an update after the host was emptied mounts the document again", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    const args = {
      ctx: NULL_FORM_CONTEXT,
      key: "author",
      onChange: () => {
        /* Not committed here */
      },
      schema: { $ref: "#/content/authors" },
      value: "ada",
    };
    const handle = referenceControl.mount(host, args);
    await settle();
    expect(picker(host)).not.toBeNull();

    host.textContent = "";
    handle.update(args);
    await settle();
    expect(picker(host)).not.toBeNull();
    expect(control(picker(host)!).value).toBe("ada");
    handle.dispose();
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
    await settle();

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

  test("a settled collection is answered from the cache — no second read, and no Loading flash", async () => {
    const first = await mountReference("", { $ref: "#/content/authors" });
    await settle();
    expect(picker(first.container)).not.toBeNull();

    /* A second field, drawn after the read settled, must not go through the loading path at all:
       the enclosing form repaints on every keystroke in the field beside it. The gate is what
       proves it — with reads held open, a field that asked again would sit disabled at "Loading…"
       for the rest of the test. */
    hold = true;
    const second = await mountReference("ada", { $ref: "#/content/authors" });
    expect(listCalls).toBe(1);
    expect(optionLabels(second.container)).toEqual(["—", "ada", "grace"]);
    expect(control(picker(second.container)!).disabled).toBe(false);
  });

  test("two fields on one collection both hear the read land", async () => {
    /* One read, MANY waiters. The flag this replaced told the first asker and nobody else, which
       was survivable while a lit template held a promise of its own and a whole panel repainted on
       the first control's behalf — and is not, now that each field is a document that redraws
       itself. */
    hold = true;
    const first = await mountReference("", { $ref: "#/content/authors" });
    const second = await mountReference("", { $ref: "#/content/authors" });
    expect(listCalls).toBe(1);
    expect(optionLabels(first.container)).toEqual(["Loading…"]);
    expect(optionLabels(second.container)).toEqual(["Loading…"]);

    await land();
    expect(optionLabels(first.container)).toEqual(["—", "ada", "grace"]);
    expect(optionLabels(second.container)).toEqual(["—", "ada", "grace"]);
  });

  test("an invalidated read settles into nothing, and the one that replaced it wins", async () => {
    /* A Retry starts a second read while the first is still in flight. Without an identity check
       the loser lands last and writes its stale answer over the winner's — and notifies a set of
       waiters belonging to the other read. "Forget this collection" has to mean the read in flight
       for it is forgotten too. */
    hold = true;
    const m = await mountReference("", { $ref: "#/content/authors" });
    expect(listCalls).toBe(1);

    invalidateReferenceEntries("authors");
    ids = ["hopper"];
    m.redraw();
    await settle();
    expect(listCalls).toBe(2);

    gates[0]!();
    await settle();
    // The stale read answered ["ada", "grace"] and nobody heard it.
    expect(optionLabels(m.container)).toEqual(["Loading…"]);

    gates[1]!();
    await settle();
    expect(optionLabels(m.container)).toEqual(["—", "hopper"]);
  });

  test("a plain renderForm field dispatches on the schema alone", async () => {
    const m = await mountReference("", { $ref: "#/content/authors" });
    await settle();
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
    await settle();
    const inline = container.querySelector('[part="row"] [part="reference"] [part="picker"]');
    expect(inline).not.toBeNull();
    choose(inline!, "ada");
    expect(patches).toEqual([{ credits: [{ author: "ada" }] }]);
  });
});
