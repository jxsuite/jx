/**
 * Tests for the reusable AI provider credentials form — `src/ui/ai-credentials-form.ts`, the flow,
 * and `src/surfaces/ai-credentials-form.json`, the document it mounts.
 *
 * Fetch is stubbed (no network), and the platform mock supplies aiChatUrl. Each form instance
 * mounts into its own ATTACHED container through a `requestRender` that re-renders it there.
 *
 * Everything is addressed by `part` and by role, because the form is a document: there is no
 * `sp-textfield` or `.ai-creds-field` to find any more. Every render is awaited — `mountSurface`
 * settles when the document has rendered, and the kit's own template is one `connectedCallback`
 * after that, so a detached container or a synchronous assertion finds nothing at all.
 *
 * The model field is one `jx-combobox` with `allows-custom-value` over the fetched catalogue, so
 * its rows are `jx-option`s under the field and a pick is a click on one; the text field and the
 * `jx-select` that stood in for it while the kit had no combobox are gone, and so is the
 * `[part="unlisted"]` row the select synthesised for a value it did not list.
 */
import { clearSeededSettings, flush, installMockPlatform, seedSettings } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "lit-html";
import { storedModel } from "../src/services/ai-settings";
import { preferredModel } from "../src/services/ai-models";
import { createAiCredentialsForm } from "../src/ui/ai-credentials-form";
import type { AiCredentialsFormOptions } from "../src/ui/ai-credentials-form";

installMockPlatform();

// ─── Fetch stub ───────────────────────────────────────────────────────────────

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
  Response.json({ models: [] }, { status: 200 });
const fetchCalls: { url: string; init?: RequestInit | undefined }[] = [];
(globalThis as Record<string, unknown>).fetch = (url: string, init?: RequestInit) => {
  fetchCalls.push({ init, url });
  return fetchImpl(url, init);
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Every container this file has attached, so one test's DOM never outlives it. */
const containers: HTMLElement[] = [];

/**
 * A form wired to re-render itself into a dedicated, attached container.
 *
 * Asynchronous: the form is a mounted document, so the first render starts a mount that has to
 * settle before anything can be found.
 */
async function makeForm(extra: Partial<AiCredentialsFormOptions> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const rerender = () => {
    render(form.render(), container);
  };
  const form = createAiCredentialsForm({ requestRender: () => rerender(), ...extra });
  rerender();
  await flush(6);
  return {
    container,
    form,
    async repaint() {
      rerender();
      await flush(4);
    },
  };
}

/** One of the document's named regions. */
function part(container: HTMLElement, name: string) {
  return container.querySelector(`[part="${name}"]`) as HTMLElement | null;
}

/** The native control inside a kit field: what a reader types into and what carries its value. */
function input(container: HTMLElement, field: string) {
  return container.querySelector(`[part="${field}"] [part="input"]`) as HTMLInputElement;
}

/** Press a kit button by the part that names it. */
function press(container: HTMLElement, name: string) {
  const button = part(container, name);
  (button?.querySelector('[part="control"]') ?? button)?.dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

/** Type into a kit field the way a reader does: the control reports, and the event bubbles. */
function type(container: HTMLElement, field: string, value: string) {
  const el = input(container, field);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The model field: one `jx-combobox` over the fetched catalogue, with its state accessors. */
function modelField(container: HTMLElement) {
  return part(container, "model") as HTMLElement & {
    value: string;
    activeIndex: number;
    allowsCustomValue: boolean;
    open: boolean;
  };
}

/** Every row the model field's list offers, by value — the catalogue as fetched, nothing added. */
function listedValues(container: HTMLElement) {
  return [...container.querySelectorAll('[part="model"] jx-option')].map((row) =>
    row.getAttribute("value"),
  );
}

/** Choose a listed model the way a reader does: a click on its row. */
function chooseListed(container: HTMLElement, value: string) {
  const row = [...container.querySelectorAll<HTMLElement>('[part="model"] jx-option')].find(
    (el) => el.getAttribute("value") === value,
  );
  if (!row) {
    throw new Error(`the catalogue does not list ${value}`);
  }
  row.click();
}

/** Drop the model field's list the way a reader does: the chevron. */
async function openModelList(container: HTMLElement) {
  (part(container, "model")!.querySelector('[part="toggle"]') as HTMLElement).click();
  await flush(2);
}

beforeEach(() => {
  localStorage.clear();
  clearSeededSettings();
  fetchCalls.length = 0;
  fetchImpl = async () => Response.json({ models: [] }, { status: 200 });
});

afterEach(() => {
  for (const node of containers.splice(0)) {
    node.remove();
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ai-credentials-form", () => {
  test("renders the gate with the default blurb and drafts survive a repaint", async () => {
    const c = await makeForm();
    expect(part(c.container, "title")!.textContent).toContain("AI provider key");
    expect(part(c.container, "note")!.textContent).toContain("Any OpenAI-compatible key works");

    type(c.container, "key", "sk-secret");
    type(c.container, "model", "gpt-4o-mini");
    type(c.container, "endpoint", "http://localhost:11434/v1");
    // Repaint from closure state: the typed values round-trip through the drafts.
    await c.repaint();
    expect(input(c.container, "key").value).toBe("sk-secret");
    expect(input(c.container, "model").value).toBe("gpt-4o-mini");
    expect(input(c.container, "endpoint").value).toBe("http://localhost:11434/v1");
  });

  test("fetchModels forwards X-Api-Key and X-Api-Base-URL and offers what came back", async () => {
    fetchImpl = async () =>
      Response.json({ models: [{ id: "gpt-4o" }, { id: "x", name: "Model X" }] }, { status: 200 });
    const c = await makeForm();
    type(c.container, "key", "sk-fetch-key");
    type(c.container, "endpoint", "http://localhost:9999/v1");
    press(c.container, "fetch");
    await flush(4);

    const call = fetchCalls.at(-1)!;
    expect(call.url).toBe("/__mock/ai/models");
    const headers = call.init!.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("sk-fetch-key");
    expect(headers["X-Api-Base-URL"]).toBe("http://localhost:9999/v1");

    // The catalogue is the model field's own list now, offering both models under the field.
    expect(listedValues(c.container)).toEqual(["gpt-4o", "x"]);
    expect(modelField(c.container).matches("[data-empty]")).toBe(false);
    expect(c.container.textContent).toContain("Model X");
    expect(part(c.container, "fetch")!.textContent).toContain("Refresh models");

    // Choosing from the list writes the model draft, persisted on Save.
    chooseListed(c.container, "gpt-4o");
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("gpt-4o");
  });

  /**
   * The catalogue is FETCHED, so the rows arrive after the field is drawn — and after whatever the
   * reader typed while they waited. The field is one `jx-combobox` with `allows-custom-value`, so a
   * self-hosted id the catalogue does not list stands exactly as typed: no row is synthesised for
   * it, and nothing about the rows arriving touches the value.
   */
  test("a value typed before the catalogue lands is not clobbered when it does", async () => {
    fetchImpl = async () => Response.json({ models: [{ id: "gpt-4o" }] }, { status: 200 });
    const c = await makeForm();
    // No rows yet: the field is a text field, with no chevron to open an empty list.
    expect(modelField(c.container).matches("[data-empty]")).toBe(true);
    type(c.container, "model", "my-self-hosted-model");
    press(c.container, "fetch");
    await flush(4);

    expect(input(c.container, "model").value).toBe("my-self-hosted-model");
    expect(modelField(c.container).value).toBe("my-self-hosted-model");
    expect(modelField(c.container).matches("[data-empty]")).toBe(false);
    /* The list is the catalogue and only the catalogue: a custom value is the FIELD's, and the old
       select's synthesised `[part="unlisted"]` row has nothing to stand in for. */
    expect(listedValues(c.container)).toEqual(["gpt-4o"]);
    expect(c.container.querySelector('[part="unlisted"]')).toBeNull();
    /* The blur on the way to Save is the COMMIT, and the commit is where a closed list would put
       the last accepted value back — the empty field. `allows-custom-value` is what lets it stand. */
    input(c.container, "model").dispatchEvent(new Event("change", { bubbles: true }));
    await c.repaint();
    expect(input(c.container, "model").value).toBe("my-self-hosted-model");
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("my-self-hosted-model");
  });

  test("a fetched list containing the typed value shows it highlighted, not as a custom entry", async () => {
    fetchImpl = async () =>
      Response.json({ models: [{ id: "gpt-4o" }, { id: "o3" }] }, { status: 200 });
    const c = await makeForm();
    type(c.container, "model", "o3");
    press(c.container, "fetch");
    await flush(4);
    expect(input(c.container, "model").value).toBe("o3");

    /* Opening the list lands on the reader's own row: the field names it as the active descendant
       and the row says selected — rather than a list with nothing chosen beside a value it holds. */
    await openModelList(c.container);
    const field = modelField(c.container);
    expect(field.open).toBe(true);
    expect(field.activeIndex).toBe(1);
    const row = c.container.querySelector('[part="model"] jx-option[value="o3"]')!;
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(input(c.container, "model").getAttribute("aria-activedescendant")).toBe(row.id);
    expect(listedValues(c.container)).toEqual(["gpt-4o", "o3"]);
    expect(c.container.querySelector('[part="unlisted"]')).toBeNull();
  });

  test("a listed pick writes the field, and Save persists the pick", async () => {
    fetchImpl = async () =>
      Response.json({ models: [{ id: "gpt-4o" }, { id: "o3" }] }, { status: 200 });
    const c = await makeForm();
    press(c.container, "fetch");
    await flush(4);

    chooseListed(c.container, "o3");
    await c.repaint();
    expect(input(c.container, "model").value).toBe("o3");
    expect(modelField(c.container).open).toBe(false);
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("o3");
  });

  /**
   * A listed id typed in the wrong case commits in the catalogue's spelling — the row is what the
   * value means — and the element has already written that spelling, to itself AND to its control,
   * when the control's own `change` reaches the surface. That is the surface's contract under test:
   * the draft and the stored model follow the row rather than the keystrokes. It does NOT tell the
   * handler's `event#/currentTarget/value` from `event#/target/value`, and nothing can: the
   * runtime's bindings are synchronous, so the control reads the same string as the element at
   * every event the surface hears. The ref is a statement of which node the form means, not a
   * behaviour.
   */
  test("a listed id typed in the wrong case commits in the catalogue's spelling", async () => {
    fetchImpl = async () => Response.json({ models: [{ id: "gpt-4o" }] }, { status: 200 });
    const c = await makeForm();
    press(c.container, "fetch");
    await flush(4);
    type(c.container, "model", "GPT-4O");
    expect(modelField(c.container).value).toBe("GPT-4O");
    input(c.container, "model").dispatchEvent(new Event("change", { bubbles: true }));
    await c.repaint();
    expect(modelField(c.container).value).toBe("gpt-4o");
    expect(input(c.container, "model").value).toBe("gpt-4o");
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("gpt-4o");
  });

  test("fetchModels surfaces an error, and offers no catalogue", async () => {
    fetchImpl = async () => new Response("nope", { status: 500 });
    const c = await makeForm();
    press(c.container, "fetch");
    await flush(4);
    expect(part(c.container, "models-error")!.textContent).toContain("HTTP 500");
    // Still a bare text field — no models arrived, so there is no list and no chevron.
    expect(listedValues(c.container)).toEqual([]);
    expect(modelField(c.container).matches("[data-empty]")).toBe(true);
  });

  test("Save persists key, endpoint, and model and fires onSaved", async () => {
    const onSaved = mock(() => {});
    const c = await makeForm({ onSaved });
    type(c.container, "key", "sk-saved");
    type(c.container, "model", "gpt-4o-mini");
    type(c.container, "endpoint", "http://localhost:11434/v1");
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.openaiKey")).toBe("sk-saved");
    expect(globalThis.localStorage.getItem("jx.ai.baseUrl")).toBe("http://localhost:11434/v1");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("gpt-4o-mini");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("Cancel is only offered when a key exists; startEdit preloads drafts and fetches models", async () => {
    const onCancel = mock(() => {});
    const c = await makeForm({ onCancel });
    // No stored key → no Cancel button.
    expect(part(c.container, "cancel")).toBeNull();

    seedSettings({ "jx.ai.openaiKey": "sk-existing" });
    fetchCalls.length = 0;
    c.form.startEdit();
    await flush(4);

    // Drafts preloaded from the stored settings; Cancel offered now that a key exists.
    expect(input(c.container, "key").value).toBe("sk-existing");
    /* Empty rather than "gpt-4o": nothing has been chosen, and a prefilled default is a choice the
       user did not make — Save would then persist it. */
    expect(input(c.container, "model").value).toBe("");
    expect(part(c.container, "cancel")).not.toBeNull();
    // StartEdit auto-fetched the model list.
    expect(fetchCalls.length).toBe(1);

    press(c.container, "cancel");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  /**
   * The reported bug, as a test.
   *
   * Save used to blank its own drafts while the Preferences sheet stayed open, so every field
   * emptied the moment a save succeeded. Blank is what the setters treat as _clear_, so the obvious
   * response — press Save again — deleted the key and endpoint the first press had just stored. A
   * real install was left holding `{"jx.ai.model": "gpt-4o"}` and nothing else.
   */
  test("Save leaves the form showing what it stored, and a second Save does not erase it", async () => {
    const c = await makeForm();
    type(c.container, "key", "sk-keepme");
    type(c.container, "endpoint", "https://opencode.ai/zen/go/v1");
    type(c.container, "model", "deepseek-v4-pro");
    press(c.container, "save");
    await flush(2);

    // The fields still show what was persisted — not blanks.
    expect(input(c.container, "key").value).toBe("sk-keepme");
    expect(input(c.container, "endpoint").value).toBe("https://opencode.ai/zen/go/v1");
    expect(input(c.container, "model").value).toBe("deepseek-v4-pro");

    // And pressing Save again is a no-op re-write rather than a revoke.
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.openaiKey")).toBe("sk-keepme");
    expect(globalThis.localStorage.getItem("jx.ai.baseUrl")).toBe("https://opencode.ai/zen/go/v1");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("deepseek-v4-pro");
  });

  /**
   * A blank model field means "whatever the provider defaults to". It must not become a stored
   * choice: prefilling the field with `getModel()`'s `"gpt-4o"` fallback and then saving it is what
   * left a real install holding `jx.ai.model: "gpt-4o"` for a provider that never served it.
   */
  test("Save with no model chosen records no model choice", async () => {
    const c = await makeForm();
    type(c.container, "key", "sk-nomodel");
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.openaiKey")).toBe("sk-nomodel");
    expect(storedModel()).toBe("");
    // A sender still has something to send.
    expect(preferredModel()).toBe("gpt-4o");
  });

  test("Save keeps the fetched catalogue, so the model field does not collapse", async () => {
    fetchImpl = async () => Response.json({ models: [{ id: "gpt-4o" }] }, { status: 200 });
    const c = await makeForm();
    type(c.container, "key", "sk-list");
    press(c.container, "fetch");
    await flush(4);
    expect(listedValues(c.container)).toEqual(["gpt-4o"]);

    press(c.container, "save");
    await flush(2);
    expect(listedValues(c.container)).toEqual(["gpt-4o"]);
    expect(modelField(c.container).matches("[data-empty]")).toBe(false);
    expect(part(c.container, "fetch")!.textContent).toContain("Refresh models");
  });

  /**
   * The precedence used to be `getOpenAiKey() || keyDraft` for the key while the endpoint beside it
   * read draft-first. Editing a key in place therefore tested the OLD one — and a form whose drafts
   * had been blanked still fetched successfully from storage, which is what made an emptied form
   * look like it was working.
   */
  test("Fetch models sends the drafted key, not the stored one", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-old" });
    fetchImpl = async () => Response.json({ models: [] }, { status: 200 });
    const c = await makeForm();
    type(c.container, "key", "sk-new");
    fetchCalls.length = 0;
    press(c.container, "fetch");
    await flush(4);
    const headers = fetchCalls.at(-1)!.init!.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("sk-new");
  });

  test("two instances keep independent draft state", async () => {
    const a = await makeForm();
    const b = await makeForm();
    type(a.container, "key", "sk-instance-a");
    await a.repaint();
    await b.repaint();
    expect(input(a.container, "key").value).toBe("sk-instance-a");
    expect(input(b.container, "key").value).toBe("");
  });

  test("is a document over the kit: masked key, named controls, and no class anywhere", async () => {
    const c = await makeForm();
    // The key field masks, and it is a kit control rather than a raw <input> the surface made.
    expect(input(c.container, "key").getAttribute("type")).toBe("password");
    expect(input(c.container, "key").getAttribute("aria-label")).toBe("AI provider key");
    expect(input(c.container, "model").getAttribute("aria-label")).toBe("Model ID");
    expect(input(c.container, "endpoint").getAttribute("aria-label")).toBe("Endpoint");
    /* The model field is ONE control: a combobox that accepts anything, over the catalogue. The
       text field and the select that stood in for it while the kit had no combobox are gone. */
    expect(modelField(c.container).localName).toBe("jx-combobox");
    expect(modelField(c.container).allowsCustomValue).toBe(true);
    expect(input(c.container, "model").getAttribute("role")).toBe("combobox");
    expect(part(c.container, "model-list")).toBeNull();
    // The form names itself, which the old `<div class="ai-creds-form">` never did.
    expect(part(c.container, "ai-creds-form")!.getAttribute("role")).toBe("group");
    expect(part(c.container, "ai-creds-form")!.getAttribute("aria-label")).toBe("AI provider key");
    /* A document styles through `part`, never through a class: every `.ai-creds*` rule moved into
       the document's own style block. */
    expect(c.container.querySelector("[class]")).toBeNull();
    for (const name of ["title", "note", "label", "models", "actions", "save"]) {
      expect(part(c.container, name)).not.toBeNull();
    }
  });

  test("intro replaces the default blurb but keeps the heading", async () => {
    const c = await makeForm({ intro: "Add a key so the agent can build your project." });
    expect(part(c.container, "note")!.textContent).toContain(
      "Add a key so the agent can build your project.",
    );
    expect(c.container.textContent).not.toContain("Any OpenAI-compatible key works");
    expect(part(c.container, "title")!.textContent).toContain("AI provider key");
  });

  test("a document taken out of its host is remounted, not lost", async () => {
    /* The one case assignment cannot answer. Something outside the surface emptied the host — a
       gate that clears its own container, a template that rebuilt the column — and the next update
       has to notice that the standing document is no longer in the page. */
    const c = await makeForm();
    const host = part(c.container, "ai-creds-form")!.parentElement!;
    host.textContent = "";
    expect(part(c.container, "ai-creds-form")).toBeNull();

    await c.repaint();
    await flush(6);
    expect(part(c.container, "ai-creds-form")).not.toBeNull();
    expect(input(c.container, "key").getAttribute("type")).toBe("password");
  });

  test("the standing mount survives a repaint of the gate around it", async () => {
    /* The host node is what lit inserts, and re-inserting the same node is a no-op — so a field the
       reader is typing into is never rebuilt underneath them. */
    const c = await makeForm();
    const before = input(c.container, "key");
    await c.repaint();
    expect(input(c.container, "key")).toBe(before);
  });
});
