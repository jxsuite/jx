/**
 * Tests for the provider catalogue as one control — `src/ui/ai-model-picker.ts`, the flow, and
 * `src/surfaces/ai-model-picker.json`, the document it mounts.
 *
 * Four of these came from ai-chat-composer.test.ts when the picker left the composer to be shared
 * with the New Project Import source. The rest cover what only a SECOND host makes observable: the
 * getModel/onChange seams, and the invariant that a list is only ever shown for the credentials it
 * was listed under.
 *
 * Everything is addressed by `part` and by role, because the picker is a document: there is no
 * `sp-picker` or `.ai-model-picker` to find any more. The container is ATTACHED and every render is
 * awaited — `mountSurface` settles when the document has rendered, and the kit's own template is
 * one `connectedCallback` after that, so a detached container or a synchronous assertion finds
 * nothing at all.
 */
import { clearSeededSettings, flush, installMockPlatform, seedSettings } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { render } from "lit-html";
import { createModelPicker } from "../src/ui/ai-model-picker";
import { resetModelCache } from "../src/services/ai-models";
import { saveAiProvider } from "../src/services/ai-settings";
import type { ModelPickerOptions } from "../src/ui/ai-model-picker";

installMockPlatform();

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
  Response.json({ models: [] }, { status: 200 });
(globalThis as Record<string, unknown>).fetch = (url: string, init?: RequestInit) =>
  fetchImpl(url, init);

/**
 * Hold the next listing open until the test says otherwise.
 *
 * A mount is awaited, so by the time anything can be asserted the ordinary stub has already
 * answered. Three of these cases are about the moment BEFORE it does, which only exists if the
 * listing is made to wait.
 *
 * @param {unknown[]} models What the held listing eventually returns.
 * @returns {() => Promise<void>} Release it, and settle the render it provokes.
 */
function holdListing(models: unknown[]) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchImpl = async () => {
    await gate;
    return Response.json({ models }, { status: 200 });
  };
  return async () => {
    release();
    await flush(4);
  };
}

/** Every container this file has attached, so one test's DOM never outlives it. */
const containers: HTMLElement[] = [];

/**
 * A picker wired to re-render itself into a dedicated, attached container.
 *
 * Asynchronous: the control is a mounted document, so the first render starts a mount that has to
 * settle before anything can be found.
 */
async function mountPicker(extra: Partial<ModelPickerOptions> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const rerender = () => {
    render(picker.render(), container);
  };
  const picker = createModelPicker({ requestRender: () => rerender(), ...extra });
  rerender();
  await flush(6);
  return {
    container,
    picker,
    async repaint() {
      rerender();
      await flush(4);
    },
  };
}

/** The document's root — what carries the width the host asked for. */
function root(container: HTMLElement) {
  return container.querySelector('[part="model-picker"]') as HTMLElement;
}

/** The kit control's host. */
function selectHost(container: HTMLElement) {
  return container.querySelector('[part="select"]') as HTMLElement;
}

/** The native control inside it: what a reader picks from, and what a change comes from. */
function control(container: HTMLElement) {
  return container.querySelector('[part="select"] [part="control"]') as HTMLSelectElement;
}

/** Every row the control offers, listed and stand-in alike, in the order they are drawn. */
function rows(container: HTMLElement) {
  return [...container.querySelectorAll('[part="select"] option')] as HTMLOptionElement[];
}

/** Row values, in order. */
function values(container: HTMLElement) {
  return rows(container).map((row) => row.getAttribute("value"));
}

/** Row labels, by value. */
function labels(container: HTMLElement) {
  return new Map(rows(container).map((row) => [row.getAttribute("value"), row.textContent ?? ""]));
}

/** Choose a row the way the native control reports one. */
function choose(container: HTMLElement, value: string) {
  const el = control(container);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  clearSeededSettings();
  resetModelCache();
  fetchImpl = async () =>
    Response.json({ models: [{ id: "gpt-4o" }, { id: "o3", name: "o3 mini" }] }, { status: 200 });
});

afterEach(() => {
  for (const node of containers.splice(0)) {
    node.remove();
  }
});

describe("ai-model-picker — listing", () => {
  test("says it is listing, then lists what came back", async () => {
    const land = holdListing([{ id: "gpt-4o" }, { id: "o3", name: "o3 mini" }]);
    const c = await mountPicker();
    // The first render kicks off the fetch; the placeholder row stands in meanwhile.
    expect(c.container.textContent).toContain("Loading models…");
    const placeholder = rows(c.container).find((r) => r.getAttribute("value") === "__loading__")!;
    // It is a state rather than a model, so it may not be chosen.
    expect(placeholder.hasAttribute("disabled")).toBe(true);

    await land();
    await c.repaint();
    expect(values(c.container)).toContain("o3");
    expect(labels(c.container).get("o3")).toContain("o3 mini");
    expect(c.container.textContent).not.toContain("Loading models…");
  });

  test("prepends a current model id the catalogue does not list", async () => {
    // A self-hosted or newly released id is the normal case, not an error.
    seedSettings({ "jx.ai.model": "my-custom-model" });
    const c = await mountPicker();
    await flush();
    await c.repaint();
    expect(values(c.container)[0]).toBe("my-custom-model");
  });

  test("a model already in the catalogue is not duplicated", async () => {
    seedSettings({ "jx.ai.model": "o3" });
    const c = await mountPicker();
    await flush();
    await c.repaint();
    expect(values(c.container).filter((v) => v === "o3")).toHaveLength(1);
  });

  test("choosing a row persists the model choice", async () => {
    const c = await mountPicker();
    await flush();
    await c.repaint();
    choose(c.container, "o3");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("o3");
  });

  test("the listing placeholder chooses nothing even when a host drives it", async () => {
    const c = await mountPicker();
    choose(c.container, "__loading__");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBeNull();
  });

  test("an empty value chooses nothing", async () => {
    const c = await mountPicker();
    await flush();
    await c.repaint();
    choose(c.container, "");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBeNull();
  });

  test("the control names itself, and the document carries no class at all", async () => {
    const c = await mountPicker();
    await flush();
    await c.repaint();
    /* The name is a PROPERTY the document sets, so it is read where it lands: on the control the
       reader actually focuses. */
    expect(control(c.container).getAttribute("aria-label")).toBe("Model");
    // A document styles through `part`; a class here would be an escape hatch back to a stylesheet.
    expect(c.container.querySelector("[class]")).toBeNull();
  });
});

describe("ai-model-picker — tool support", () => {
  test("labels a model the backend says cannot call tools, and lists it anyway", async () => {
    /* Labelled, never filtered or disabled: a chat-only model is a legitimate choice, and hiding
       half a managed catalogue would report a capability gap as an outage. */
    fetchImpl = async () =>
      Response.json(
        {
          models: [
            { id: "@cf/meta/llama-4", toolSupport: true },
            { id: "@cf/tiny/chat", name: "Tiny Chat", toolSupport: false },
            { id: "gpt-4o" },
          ],
        },
        { status: 200 },
      );
    seedSettings({ "jx.ai.model": "@cf/meta/llama-4" });
    const c = await mountPicker();
    await flush();
    await c.repaint();

    const byValue = labels(c.container);
    expect(byValue.get("@cf/tiny/chat")).toContain("Tiny Chat — no tools");
    // A model that CAN, and one the backend said nothing about, are both left unadorned.
    expect(byValue.get("@cf/meta/llama-4")).not.toContain("no tools");
    expect(byValue.get("gpt-4o")).not.toContain("no tools");
    expect(byValue.size).toBe(3);
  });

  test("selectedLacksTools reads the stored choice", async () => {
    const land = holdListing([{ id: "@cf/tiny/chat", toolSupport: false }]);
    seedSettings({ "jx.ai.model": "@cf/tiny/chat" });
    const c = await mountPicker();
    // Before the catalogue lands nothing is known, so nothing is claimed.
    expect(c.picker.selectedLacksTools()).toBe(false);
    await land();
    expect(c.picker.selectedLacksTools()).toBe(true);
  });
});

describe("ai-model-picker — failure", () => {
  /**
   * Retry is a button beside the control, not a row inside it.
   *
   * As a row it was a value the control could hold and did not mean: one press left the picker
   * reporting `__retry_models__` as the chosen model, and the write that would have corrected it is
   * exactly the write a document's bindings skip when the scope never moved.
   */
  test("a failed listing offers Retry beside the picker, which lists again", async () => {
    fetchImpl = async () => new Response("boom", { status: 500 });
    const c = await mountPicker();
    await flush();
    await c.repaint();
    const retry = c.container.querySelector('[part="retry"]') as HTMLElement;
    expect(retry).not.toBeNull();
    // The refusal is never a row, so it can never be mistaken for a model.
    expect(values(c.container)).not.toContain("__retry_models__");
    expect(selectHost(c.container).getAttribute("title")).toContain("HTTP 500");
    expect(c.picker.error()).toContain("HTTP 500");

    fetchImpl = async () => Response.json({ models: [{ id: "recovered" }] }, { status: 200 });
    (retry.querySelector('[part="control"]') ?? retry).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flush();
    await c.repaint();
    expect(values(c.container)).toContain("recovered");
    expect(c.container.querySelector('[part="retry"]')).toBeNull();
    // Nothing about a retry is a model choice.
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBeNull();
  });

  test("a failed fetch is not retried on every render", async () => {
    let calls = 0;
    fetchImpl = async () => {
      calls += 1;
      return new Response("boom", { status: 500 });
    };
    const c = await mountPicker();
    await flush();
    await c.repaint();
    await c.repaint();
    await c.repaint();
    expect(calls).toBe(1);
  });

  test("a fetch rejection with no message still reports something", async () => {
    // A rejection value that carries no `message` — the fallback exists because `fetch` and the
    // Platform layer are free to reject with anything.
    const messageless = { name: "TypeError" } as unknown as Error;
    fetchImpl = async () => {
      throw messageless;
    };
    const c = await mountPicker();
    await flush();
    expect(c.picker.error()).toBe("Failed to fetch models");
  });

  test("isLoading reports the in-flight fetch", async () => {
    const land = holdListing([{ id: "gpt-4o" }]);
    const c = await mountPicker();
    expect(c.picker.isLoading()).toBe(true);
    await land();
    expect(c.picker.isLoading()).toBe(false);
  });
});

describe("ai-model-picker — the second host's seams", () => {
  test("getModel and onChange keep a draft out of the application preference", async () => {
    /* The Import form chooses a model for ONE run. Writing it through setModel would silently
       retarget the assistant, which the user did not ask for. */
    let draft = "gpt-4o";
    const onChange = mock((id: string) => {
      draft = id;
    });
    const c = await mountPicker({ getModel: () => draft, onChange });
    await flush();
    await c.repaint();

    choose(c.container, "o3");
    expect(onChange).toHaveBeenCalledWith("o3");
    expect(draft).toBe("o3");
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBeNull();
  });

  test("width and size are the host's to set, and neither is a class", async () => {
    const compact = await mountPicker();
    await flush();
    await compact.repaint();
    expect(root(compact.container).dataset.width).toBe("compact");
    expect(selectHost(compact.container).dataset.size).toBe("sm");

    const filled = await mountPicker({ size: "md", width: "fill" });
    await flush();
    await filled.repaint();
    expect(root(filled.container).dataset.width).toBe("fill");
    expect(selectHost(filled.container).dataset.size).toBe("md");
  });

  test("selectedLacksTools tracks the host's own current choice", async () => {
    fetchImpl = async () =>
      Response.json(
        { models: [{ id: "gpt-4o" }, { id: "@cf/tiny/chat", toolSupport: false }] },
        { status: 200 },
      );
    let draft = "gpt-4o";
    const c = await mountPicker({
      getModel: () => draft,
      onChange: (id: string) => {
        draft = id;
      },
    });
    await flush();
    await c.repaint();
    // The backend said nothing about gpt-4o, and silence is not "no tools".
    expect(c.picker.selectedLacksTools()).toBe(false);

    choose(c.container, "@cf/tiny/chat");
    expect(c.picker.selectedLacksTools()).toBe(true);
  });

  test("a credential change makes the catalogue unavailable rather than stale", async () => {
    /* The list is read from cachedModels(credentials) on every render, never held here. Holding it
       is what once let the picker offer one provider's models while another was configured. */
    const c = await mountPicker();
    await flush();
    await c.repaint();
    expect(values(c.container)).toContain("o3");

    fetchImpl = async () => Response.json({ models: [{ id: "llama-3" }] }, { status: 200 });
    saveAiProvider({ apiKey: "sk-other", baseUrl: "https://elsewhere.example/v1", model: "" });
    await c.repaint();
    expect(values(c.container)).not.toContain("o3");

    await flush();
    await c.repaint();
    expect(values(c.container)).toContain("llama-3");
  });

  test("a document taken out of its host is remounted, not lost", async () => {
    /* The one case assignment cannot answer. Something outside the surface emptied the host — a
       host that clears its own container, a template that rebuilt the row — and the next update
       has to notice that the standing document is no longer in the page. */
    const c = await mountPicker();
    await flush();
    await c.repaint();
    const host = root(c.container).parentElement!;
    host.textContent = "";
    expect(root(c.container)).toBeNull();

    await c.repaint();
    await flush(6);
    expect(root(c.container)).not.toBeNull();
    expect(values(c.container)).toContain("o3");
  });

  test("the standing mount survives a repaint of the row around it", async () => {
    /* The host node is what lit inserts, and re-inserting the same node is a no-op — so a control
       the reader has open is never taken out from under them. */
    const c = await mountPicker();
    await flush();
    await c.repaint();
    const before = selectHost(c.container);
    await c.repaint();
    expect(selectHost(c.container)).toBe(before);
  });
});
