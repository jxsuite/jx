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
import { clearAiProvider, storedModel } from "../src/services/ai-settings";
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

  /**
   * The proxy answers 200 even when the UPSTREAM /models call failed (Cloudflare Workers AI has no
   * such route at all, so this is the only shape that failure ever takes) — `fetchAvailableModels`
   * never throws for it, so without this the form looked like it had fetched successfully while
   * quietly showing fake OpenAI defaults instead of the user's own provider's models.
   */
  test("fetchModels surfaces the upstream's own reason even on a 200 with defaults", async () => {
    fetchImpl = async () =>
      Response.json(
        {
          models: [{ id: "gpt-4o" }],
          configured: true,
          upstreamError: 404,
          upstreamMessage: "No route for that URI",
        },
        { status: 200 },
      );
    const c = await makeForm();
    press(c.container, "fetch");
    await flush(4);
    expect(part(c.container, "models-error")!.textContent).toContain("No route for that URI");
    expect(part(c.container, "models-error")!.textContent).toContain("type the model ID directly");
  });

  /**
   * The reason is often an upstream body passed through whole, and a JSON body is one unbroken
   * word. A flex item's automatic minimum is its min-content width, so the error set the `models`
   * row's width, pushed past the 320px column, and scrolled Preferences › Assistant sideways. It
   * reflows instead, and is shown whole. happy-dom does not lay out, so this asserts the rules that
   * do.
   */
  test("an unbroken upstream reason reflows inside the column instead of widening it", async () => {
    const body = '{"error":{"message":"Incorrect_API_key_provided:_sk-xxxxxxxxxxxxxxxxxxxxxxxx"}}';
    fetchImpl = async () =>
      Response.json(
        { models: [], configured: true, upstreamError: 401, upstreamMessage: body },
        { status: 200 },
      );
    const c = await makeForm();
    press(c.container, "fetch");
    await flush(4);
    const error = part(c.container, "models-error")!;
    expect(error.textContent).toContain(body);
    expect(getComputedStyle(error).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(error).minWidth).toBe("0");
    /* And it takes a line of its own under the button rather than a column beside it. Reflowed but
       still beside `Fetch models`, six lines of this body began 96px into the 320px column, indented
       past the button they answer for, with the button floating at their middle. A basis of the
       whole line in a row that wraps cannot share one. */
    expect(getComputedStyle(error).flexBasis).toBe("100%");
    expect(getComputedStyle(part(c.container, "models")!).flexWrap).toBe("wrap");
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

  /**
   * The reported defect: the pair was drawn from facts that had nothing to do with pending edits —
   * Save always, Cancel whenever a key was stored — so Preferences showed a Save that would
   * re-store what was there and a Cancel that abandoned nothing. The pair is now the pending edit's
   * own affordance: absent at rest, drawn by the first change, and taken away by either answer.
   */
  test("Save and Cancel appear only while the drafts differ from what is stored", async () => {
    const onCancel = mock(() => {});
    const c = await makeForm({ onCancel });
    // Nothing stored and nothing typed: nothing to keep and nothing to abandon.
    expect(part(c.container, "actions")).toBeNull();
    expect(part(c.container, "save")).toBeNull();
    expect(part(c.container, "cancel")).toBeNull();

    seedSettings({ "jx.ai.openaiKey": "sk-existing", "jx.ai.baseUrl": "http://h/v1" });
    fetchCalls.length = 0;
    c.form.startEdit();
    await flush(4);

    // Drafts preloaded from the stored settings.
    expect(input(c.container, "key").value).toBe("sk-existing");
    /* Empty rather than "gpt-4o": nothing has been chosen, and a prefilled default is a choice the
       user did not make — Save would then persist it. */
    expect(input(c.container, "model").value).toBe("");
    // StartEdit auto-fetched the model list.
    expect(fetchCalls.length).toBe(1);
    /* A stored key is no longer a reason to offer Cancel: the form shows exactly what is stored,
       so there is still nothing to abandon. */
    expect(part(c.container, "save")).toBeNull();
    expect(part(c.container, "cancel")).toBeNull();

    type(c.container, "endpoint", "http://elsewhere/v1");
    expect(part(c.container, "save")).not.toBeNull();
    expect(part(c.container, "cancel")).not.toBeNull();

    press(c.container, "cancel");
    await flush(2);
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Cancel put the stored value back, and with nothing left to abandon it took itself away.
    expect(input(c.container, "endpoint").value).toBe("http://h/v1");
    expect(part(c.container, "save")).toBeNull();
    expect(part(c.container, "cancel")).toBeNull();
    expect(globalThis.localStorage.getItem("jx.ai.baseUrl")).toBe("http://h/v1");
  });

  test("undoing an edit by hand takes the pair away", async () => {
    const c = await makeForm();
    type(c.container, "key", "sk-x");
    expect(part(c.container, "save")).not.toBeNull();
    type(c.container, "key", "");
    expect(part(c.container, "save")).toBeNull();
    expect(part(c.container, "cancel")).toBeNull();
  });

  /**
   * Save stores each value through its definition's `normalize` — a key trimmed, an endpoint
   * without its trailing slash — so a draft that differs only in what Save would erase is not an
   * edit: the store would come out exactly as it went in.
   */
  test("a difference the store would normalise away is not an edit", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-a", "jx.ai.baseUrl": "http://h/v1" });
    const c = await makeForm();
    c.form.startEdit();
    await flush(4);
    type(c.container, "endpoint", "http://h/v1/");
    type(c.container, "key", " sk-a ");
    expect(part(c.container, "save")).toBeNull();
    expect(part(c.container, "cancel")).toBeNull();
    // And a real difference beside them still counts.
    type(c.container, "model", "o3");
    expect(part(c.container, "save")).not.toBeNull();
  });

  /**
   * A draft the reader never touched is a view of the store, so a credential changed or revoked
   * elsewhere — a Disconnect in Preferences › Accounts, another window — reaches it on the next
   * repaint instead of surfacing as an unsaved edit that Save would write back. A draft the reader
   * DID edit is theirs, and a repaint never takes it.
   */
  test("an untouched draft follows the store; an edited one is kept", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-a" });
    const c = await makeForm();
    c.form.startEdit();
    await flush(4);
    expect(input(c.container, "key").value).toBe("sk-a");

    clearAiProvider();
    await c.repaint();
    // The revoked key is not held over as an "edit" that Save would store again.
    expect(input(c.container, "key").value).toBe("");
    expect(part(c.container, "save")).toBeNull();

    type(c.container, "endpoint", "http://mine");
    seedSettings({ "jx.ai.openaiKey": "sk-b" });
    await c.repaint();
    expect(input(c.container, "key").value).toBe("sk-b");
    expect(input(c.container, "endpoint").value).toBe("http://mine");
    // The endpoint is still the reader's edit, so there is still something to commit.
    expect(part(c.container, "save")).not.toBeNull();
    expect(part(c.container, "cancel")).not.toBeNull();
  });

  /**
   * The two questions — "is this dirty?" and "has the reader touched this?" — have to be answered
   * by the same rule. Raw equality made a whitespace-only draft touched but not dirty: no Save and
   * no Cancel were drawn, so nothing could reset it, and the revoked key then sat in the field with
   * a Save offering to store it back.
   */
  test("a normalisation-only draft still follows the store, and a Disconnect empties it", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-a" });
    const c = await makeForm();
    c.form.startEdit();
    await flush(4);
    type(c.container, "key", " sk-a ");
    // Nothing to keep and nothing to abandon: Save would store what is already there.
    expect(part(c.container, "save")).toBeNull();
    expect(part(c.container, "cancel")).toBeNull();

    clearAiProvider();
    await c.repaint();
    expect(input(c.container, "key").value).toBe("");
    expect(part(c.container, "save")).toBeNull();
  });

  /**
   * The New Project gates create the form and never call `startEdit`. Their drafts used to begin
   * blank over whatever was stored, so a stored endpoint or model read as an edit — and Save then
   * overwrote both with nothing.
   */
  test("a host that never calls startEdit starts from the store", async () => {
    seedSettings({ "jx.ai.model": "m1", "jx.ai.baseUrl": "http://h/v1" });
    const c = await makeForm();
    expect(input(c.container, "model").value).toBe("m1");
    expect(input(c.container, "endpoint").value).toBe("http://h/v1");
    expect(part(c.container, "save")).toBeNull();

    type(c.container, "key", "sk-gate");
    press(c.container, "save");
    expect(globalThis.localStorage.getItem("jx.ai.openaiKey")).toBe("sk-gate");
    // What was already stored survives the gate's Save rather than being blanked by it.
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("m1");
    expect(globalThis.localStorage.getItem("jx.ai.baseUrl")).toBe("http://h/v1");
  });

  /**
   * Answering takes the pair away, so the button the reader pressed is gone the moment it acts. Its
   * focus would fall to `<body>` — in a modal sheet, nowhere — so it lands on the key field
   * instead. A repaint while the reader is in a FIELD moves nothing.
   */
  test("answering from the keyboard leaves focus in the form, not on <body>", async () => {
    const c = await makeForm();
    type(c.container, "endpoint", "http://h/v1");
    input(c.container, "endpoint").focus();
    await c.repaint();
    expect(document.activeElement).toBe(input(c.container, "endpoint"));

    const control = (part(c.container, "cancel")!.querySelector('[part="control"]') ??
      part(c.container, "cancel")!) as HTMLElement;
    control.focus();
    expect(document.activeElement).toBe(control);
    press(c.container, "cancel");
    expect(part(c.container, "cancel")).toBeNull();
    expect(document.activeElement).toBe(input(c.container, "key"));

    type(c.container, "key", "sk-focus");
    const save = (part(c.container, "save")!.querySelector('[part="control"]') ??
      part(c.container, "save")!) as HTMLElement;
    save.focus();
    press(c.container, "save");
    expect(part(c.container, "save")).toBeNull();
    expect(document.activeElement).toBe(input(c.container, "key"));
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
    type(c.container, "endpoint", "https://opencode.ai/zen/go/v1/");
    type(c.container, "model", "deepseek-v4-pro");
    press(c.container, "save");
    await flush(2);

    // The fields still show what was persisted — not blanks, and not the slash the store dropped.
    expect(input(c.container, "key").value).toBe("sk-keepme");
    expect(input(c.container, "endpoint").value).toBe("https://opencode.ai/zen/go/v1");
    expect(input(c.container, "model").value).toBe("deepseek-v4-pro");

    /* And there is no second Save to press: the drafts now ARE the store, so the pair went away
       with the edit it answered. A press finds nothing, and nothing is revoked. */
    expect(part(c.container, "save")).toBeNull();
    expect(part(c.container, "cancel")).toBeNull();
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
    for (const name of ["title", "note", "label", "models"]) {
      expect(part(c.container, name)).not.toBeNull();
    }
    // The commit pair is named too, once there is something to commit.
    type(c.container, "key", "sk-x");
    for (const name of ["actions", "cancel", "save"]) {
      expect(part(c.container, name)).not.toBeNull();
    }
    expect(c.container.querySelector("[class]")).toBeNull();
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
