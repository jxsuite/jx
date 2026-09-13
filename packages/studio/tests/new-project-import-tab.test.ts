/**
 * The New Project wizard's Import flow: the credentials gate and URL validation on the source step,
 * the hand-off from the second step (identity plus the destination the user chose), the brief the
 * assistant is left to read, and the breakpoint policy the three controls describe.
 *
 * Everything on screen is addressed by `part`, because the wizard is a document
 * (`src/surfaces/new-project.json`): there is no `.new-project-breakpoint-mode` to find any more,
 * and the model picker and the credentials form are mounted documents of their own that the wizard
 * hosts as islands.
 */
import {
  clearSeededSettings,
  flush,
  installMockPlatform,
  mountOverlayLayers,
  npDialog,
  npDismiss,
  npFillLocation,
  npFooter,
  npLocation,
  npName,
  npPart,
  npParts,
  npPickTab,
  npPress,
  npPreview,
  npSlug,
  npType,
  seedSettings,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { resetModelCache } from "../src/services/ai-models";
import type { ImportTabCtx } from "../src/new-project/import-tab";
import type { ImportProgressEvent } from "../src/types";

const { openNewProjectModal } = await import("../src/new-project/new-project-modal");
const { breakpointPolicyFromForm, handoffImport, importBriefFor, importButtonLabel } =
  await import("../src/new-project/import-tab");
const { clearPendingImportBrief, pendingImportBrief } = await import("../src/services/import-seed");
const { initLayers } = await import("../src/ui/layers");

mountOverlayLayers(document.body);
initLayers();

/** The native control the kit draws inside one of the wizard's fields. */
function control(part: string): HTMLInputElement {
  return npPart(part)?.querySelector('[part="input"], [part="control"]') as HTMLInputElement;
}

/** The Import source step's Site URL field. */
function urlField(): HTMLInputElement {
  return control("url");
}

/** The Project Name field's inline validation message. */
function nameError(): string {
  return npPart("name-failure")?.textContent?.trim() ?? "";
}

/** The inline error rendered under the destination fields. */
function inlineError(): string {
  return npPart("destination-failure")?.textContent?.trim() ?? "";
}

/** The Import step's own refusal, which is about the URL rather than about the destination. */
function importError(): string {
  return npPart("import-failure")?.textContent?.trim() ?? "";
}

/** Set a control's value and fire the `change` a picker or number field commits on. */
function commit(part: string, value: string): void {
  const el = control(part);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Flip one of the step's switches. */
function flip(part: string, on: boolean): void {
  const el = control(part);
  el.checked = on;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * A hand-built ImportTabCtx for driving handoffImport directly (the wizard only ever hands it a
 * filesystem destination), paired with a counter for the rerenders it requests.
 *
 * Three members shorter than it used to be: the credentials form, the keyless offer and the AI gate
 * were the tab's to render and are the wizard's to decide, so the context is the brief's
 * dependencies and nothing else.
 */
function directCtx(resolveDestination: ImportTabCtx["resolveDestination"]) {
  const counter = { rerenders: 0 };
  const ctx: ImportTabCtx = {
    form: { directory: "site", name: "Site" },
    onHandoff: mock(() => {}),
    rerender: () => {
      counter.rerenders += 1;
    },
    resolveDestination,
  };
  return { counter, ctx };
}

interface CapturedImport {
  opts: Record<string, unknown>;
  onProgress: (evt: ImportProgressEvent) => void;
  signal: AbortSignal | undefined;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let captured: CapturedImport | null = null;

function importPlatform() {
  return installMockPlatform({
    importSite: ((
      opts: Record<string, unknown>,
      onProgress: (evt: ImportProgressEvent) => void,
      signal?: AbortSignal,
    ) =>
      new Promise((resolve, reject) => {
        captured = { onProgress, opts, reject, resolve, signal };
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as never,
  });
}

function setKey() {
  seedSettings({
    "jx.ai.openaiKey": "sk-import-test",
    "jx.ai.baseUrl": "http://llm.local/v1",
    "jx.ai.model": "test-model",
  });
}

/**
 * Open the wizard on the Import tab, past the gate.
 *
 * The wizard's own promise comes back WRAPPED, and the wrapper is not decoration: `await` unwraps a
 * thenable recursively, so an async helper that returned the promise directly would wait for the
 * wizard to be answered before its own caller resumed — every test in this file would sit there
 * until the 5s timeout.
 */
async function reachSource(): Promise<{ promise: ReturnType<typeof openNewProjectModal> }> {
  const promise = openNewProjectModal();
  await flush(3);
  npPickTab("import");
  /* The model picker is a mounted document of its own, so the step is not finished on the turn the
     body switch reconciles onto it. */
  await flush(6);
  return { promise };
}

/** Open the wizard, switch to Import, fill the URL, and advance to the second step. */
async function reachParams(
  url = "https://clone.example/",
): Promise<{ promise: ReturnType<typeof openNewProjectModal> }> {
  const opened = await reachSource();
  npType(urlField(), url);
  await flush();
  npPress("Confirm");
  await flush(3);
  return opened;
}

/* The credentials gate probes the AI proxy for backend-held credentials; default it to a plain
   BYOK-only backend, and let managed/env-keyed tests override. */
let proxyState: { configured: boolean; managed: boolean } = { configured: false, managed: false };
/* What the proxy lists. Empty by default — the model picker still offers the current model, which
   it prepends — and set by the one test that needs a SECOND model to choose. */
let proxyModels: { id: string }[] = [];
(globalThis as Record<string, unknown>).fetch = async () =>
  Response.json({ models: proxyModels, ...proxyState }, { status: 200 });

beforeEach(() => {
  clearPendingImportBrief();
  captured = null;
  localStorage.clear();
  clearSeededSettings();
  proxyState = { configured: false, managed: false };
  proxyModels = [];
  resetModelCache(); // Re-arms the one-shot probe between tests.
});

afterEach(() => {
  npDismiss();
});

describe("Import source step", () => {
  test("shows the AI credentials form when no key is stored, with no Next button", async () => {
    importPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("import");
    await flush(4);
    expect(npPart("creds")).toBeTruthy();
    expect(npPart("ai-creds-form")).toBeTruthy();
    // Only Cancel in the footer while gated.
    expect(npFooter()).toEqual(["Cancel"]);
  });

  test("opens the gate for a backend holding its own credentials, with no key stored", async () => {
    /* Regression: gating on hasOpenAiKey() alone blocked env-keyed dev servers and managed cloud
       platforms, whose AI already works without anything stored in this browser. */
    proxyState = { configured: true, managed: false };
    importPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("import");
    await flush(4);

    expect(localStorage.getItem("jx.ai.openaiKey")).toBeNull();
    expect(npPart("creds")).toBeNull();
    expect(npFooter()).toEqual(["Cancel", "Next"]);
  });

  test("shows the URL, crawl options, model and brief once a key is stored", async () => {
    setKey();
    importPlatform();
    await reachSource();
    await flush(2);
    expect(npPart("creds")).toBeNull();
    // Two text fields: the site URL, and the brief handed to the assistant afterwards.
    expect(urlField()).toBeTruthy();
    expect(npPart("import-prompt")).toBeTruthy();
    expect(
      npPart("model-island")?.querySelector('[part="model-picker"][data-width="fill"]'),
    ).toBeTruthy();
    // Crawl depth, max pages, and how many breakpoints the project keeps.
    expect(npPart("depth")).toBeTruthy();
    expect(npPart("max-pages")).toBeTruthy();
    expect(npPart("bp-count")).toBeTruthy();
    expect(npPart("bp-mode")).toBeTruthy();
    expect(npPart("bp-rounding")).toBeTruthy();
    expect(npPart("ai-naming")).toBeTruthy();
    expect(npFooter()).toEqual(["Cancel", "Next"]);
  });

  test("rejects an invalid URL inline on Next", async () => {
    setKey();
    importPlatform();
    await reachSource();
    npType(urlField(), "not a url");
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(importError()).toContain("valid URL");
    // Still on the source step.
    expect(npPart("tabs")).toBeTruthy();
    expect(captured).toBeNull();
  });

  test("prefills the project name and directory from the hostname", async () => {
    setKey();
    importPlatform();
    await reachParams("https://www.coffee-shop.example/menu");
    // Second step: name and slug carry the hostname prefill; the destination is never guessed,
    // So the Location field starts empty.
    expect(npName().value).toBe("coffee-shop.example");
    expect(npSlug().value).toBe("coffee-shop-example");
    expect(npLocation()).toBeTruthy();
    expect(npLocation().value).toBe("");
    // Import parameters are identity-only: no adapter picker, no design sections.
    expect(npParts("visibility")).toHaveLength(0);
  });
});

describe("Import — the brief the form hands over", () => {
  test("an empty project name blocks the hand-off and shows the inline name error", async () => {
    setKey();
    importPlatform();
    await reachParams();
    npFillLocation();
    await flush();
    npType(npName(), ""); // Clear the prefilled name.
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(pendingImportBrief()).toBeNull();
    // The wizard — not the tab — owns identity validation, so the message lands on the field.
    expect(nameError()).toBe("Project name is required");
  });

  test("a missing Location blocks the hand-off", async () => {
    setKey();
    importPlatform();
    await reachParams();
    // Location left empty: the name and slug are prefilled, so only the destination is missing.
    npPress("Confirm");
    await flush(2);
    expect(pendingImportBrief()).toBeNull();
    expect(inlineError()).toContain("Choose a location for the project folder");
    // Still on the second step, ready for the user to choose one.
    expect(npLocation()).toBeTruthy();
    expect(importButtonLabel()).toBe("Import Site");
  });

  test("the brief carries the Location joined with the slug", async () => {
    setKey();
    importPlatform();
    await reachParams();
    npFillLocation("/home/dev/Sites");
    await flush();
    npType(npName(), "My Clone");
    await flush();
    npType(npSlug(), "clone-dir");
    await flush();
    expect(npPreview()).toContain("/home/dev/Sites/clone-dir");
    npPress("Confirm");
    await flush(2);
    expect(pendingImportBrief()!.directory).toBe("/home/dev/Sites/clone-dir");
  });

  test("a blank directory defaults to the name's slug", async () => {
    setKey();
    importPlatform();
    await reachParams();
    npFillLocation();
    await flush();
    npType(npName(), "Coffee & Cream");
    await flush();
    npType(npSlug(), ""); // Clear the derived directory.
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(pendingImportBrief()).toMatchObject({
      directory: "/home/dev/Sites/coffee-cream",
      name: "Coffee & Cream",
    });
  });

  test("crawl options, the AI-naming switch and the prompt all reach the brief", async () => {
    setKey();
    importPlatform();
    await reachSource();
    npType(urlField(), "https://clone.example/");
    await flush();

    commit("depth", "2");
    commit("max-pages", "50");
    flip("ai-naming", false);
    npType(control("import-prompt"), "Modernise the typography");
    await flush();

    npPress("Confirm");
    await flush(3);
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(pendingImportBrief()).toMatchObject({
      aiComponents: false,
      depth: 2,
      maxPages: 50,
      prompt: "Modernise the typography",
      url: "https://clone.example/",
    });
  });

  /*
   * The fidelity bar (jxsuite/jx issue 232). It appears WITH the check it belongs to: a minimum
   * for a comparison nobody asked to run is a number with nothing to measure.
   */
  test("the fidelity minimum appears only once the fidelity check is on", async () => {
    setKey();
    importPlatform();
    await reachSource();
    // No fidelity bar while the check is off.
    expect(npPart("min-fidelity")).toBeNull();

    flip("verify", true);
    await flush(2);

    expect(npPart("min-fidelity")).toBeTruthy();
    expect(npPart("fidelity-row")?.textContent).toContain("did not match the original");
  });

  test("the fidelity minimum reaches the brief", async () => {
    setKey();
    importPlatform();
    await reachSource();
    npType(urlField(), "https://clone.example/");
    await flush();
    flip("verify", true);
    await flush(2);

    commit("min-fidelity", "60");
    npPress("Confirm");
    await flush(3);
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(pendingImportBrief()).toMatchObject({ minFidelity: 60, verify: true });
  });

  // A percentage is the only thing this number can be, so the field refuses to carry anything else.
  test("the fidelity minimum is clamped to a percentage", async () => {
    setKey();
    importPlatform();
    await reachSource();
    npType(urlField(), "https://clone.example/");
    await flush();
    flip("verify", true);
    await flush(2);

    /* Read the brief directly rather than through the footer: handing off CLOSES the wizard, so a
       loop that presses Import Site could only ever check its first case. */
    const { ctx } = directCtx(() => ({ kind: "path", parent: "/home/dev/Sites" }));
    for (const [typed, expected] of [
      ["250", 100],
      ["-5", 0],
      ["", 0],
      ["60", 60],
    ] as const) {
      commit("min-fidelity", typed);
      expect(importBriefFor(ctx)).toMatchObject({ minFidelity: expected });
    }
  });

  test("Import Site is a no-op when the platform lacks importSite", () => {
    installMockPlatform();
    const { counter, ctx } = directCtx(() => ({ kind: "path", parent: "/home/dev/Sites" }));
    handoffImport(ctx);
    expect(counter.rerenders).toBe(0);
    expect(ctx.onHandoff).not.toHaveBeenCalled();
  });

  test("a repository destination hands off as owner/repo", async () => {
    setKey();
    importPlatform();
    await reachSource();
    npType(urlField(), "https://clone.example/");
    await flush();
    /* This used to be "a repository destination never hands off", because the only backends that
       imported wrote to a folder. A backend that commits the emitted project into a git tree has no
       directory to name, so `owner/repo` IS the destination — refusing it here would take the
       import tab away from the platform that most needs it. */
    const { counter, ctx } = directCtx(() => ({
      kind: "repo",
      owner: "acme",
      private: true,
      repo: "site",
    }));
    handoffImport(ctx);
    expect(ctx.onHandoff).toHaveBeenCalled();
    expect(counter.rerenders).toBe(0);
  });

  test("a missing or non-web URL is refused before the destination is resolved", async () => {
    setKey();
    importPlatform();
    await reachSource();
    let resolved = 0;
    const { counter, ctx } = directCtx(() => {
      resolved += 1;
      return { kind: "path", parent: "/home/dev/Sites" };
    });

    // No URL at all (the source step never validated one).
    handoffImport(ctx);
    expect(ctx.onHandoff).not.toHaveBeenCalled();
    expect(counter.rerenders).toBe(1);

    // Parsable, but not an http(s) site.
    npType(urlField(), "ftp://files.example/");
    await flush();
    handoffImport(ctx);
    expect(ctx.onHandoff).not.toHaveBeenCalled();
    expect(counter.rerenders).toBe(2);
    expect(resolved).toBe(0);
  });
});

describe("Import — the model picker", () => {
  test("a chosen model reaches the brief without retargeting the assistant", async () => {
    /* The picker writes a DRAFT, not `jx.ai.model`: choosing a model for one import must not
       silently change which model every later chat turn runs on. */
    proxyModels = [{ id: "o3-import" }];
    /* Distinct credentials rather than `setKey()`: the tab's picker is a module singleton that
       remembers which connection it last listed FOR, so re-listing under the same key is exactly
       what it declines to do. A different endpoint is a different connection, and the catalogue
       lands. */
    seedSettings({
      "jx.ai.baseUrl": "http://picker.local/v1",
      "jx.ai.model": "test-model",
      "jx.ai.openaiKey": "sk-import-picker",
    });
    importPlatform();
    await reachParams();
    npFillLocation();
    await flush();
    npType(npName(), "Cloned Site");
    await flush();

    // Step back to the source step, where the picker lives, and choose.
    npPress("Back");
    // The catalogue has to have landed before there is a second row to pick.
    await flush(6);
    const picker = npPart("model-island")!.querySelector(
      '[part="model-picker"] [part="control"]',
    ) as HTMLSelectElement;
    picker.value = "o3-import";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    npPress("Confirm");
    await flush(3);
    npPress("Confirm");
    await flush(2);

    expect(pendingImportBrief()!.model).toBe("o3-import");
    // The application preference is untouched.
    expect(globalThis.localStorage.getItem("jx.ai.model")).toBe("test-model");
  });

  test("an untouched picker leaves the model empty, and the tool falls back", async () => {
    setKey();
    importPlatform();
    await reachParams();
    npFillLocation();
    await flush();
    npType(npName(), "Cloned Site");
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(pendingImportBrief()!.model).toBe("");
  });
});

describe("Import — the hand-off", () => {
  test("the wizard closes with no project, because it created none", async () => {
    /* `import_site` is `no-project` tiered and does the creating — including the git init every
       create path owes. The wizard's promise resolves null, the same as a dismissal. */
    setKey();
    importPlatform();
    const { promise } = await reachParams();
    npFillLocation();
    await flush();
    npType(npName(), "Cloned Site");
    await flush();
    npPress("Confirm");

    expect(await promise).toBeNull();
    await flush();
    expect(npDialog()).toBeNull();
    // Nothing was imported by the wizard itself.
    expect(captured).toBeNull();
  });

  test("the brief is left for the tool to read, not consumed on hand-off", async () => {
    setKey();
    importPlatform();
    await reachParams();
    npFillLocation();
    await flush();
    npType(npName(), "Cloned Site");
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(pendingImportBrief()).toMatchObject({
      depth: 1,
      directory: "/home/dev/Sites/cloned-site",
      maxPages: 20,
      name: "Cloned Site",
      url: "https://clone.example/",
    });
  });
});

// ─── Breakpoints ─────────────────────────────────────────────────────────────

describe("Import — how many breakpoints the project keeps", () => {
  test("defaults to three, evenly spaced, rounding to the nearest declared width", async () => {
    /*
     * A real site declares as many breakpoints as it has accumulated frameworks. One import
     * produced NINE — 520, 600, 767, 781, 782, 960, 1024, 1025, 1390 — and every one of them became
     * a canvas size in Studio and a column in every style editor. Three is the default because that
     * is the complaint this control answers.
     */
    setKey();
    importPlatform();
    await reachSource();
    expect(breakpointPolicyFromForm()).toEqual({
      count: 3,
      mode: "limit",
      rounding: "nearest",
    });
  });

  test("the count and the rounding are the author's to change", async () => {
    setKey();
    importPlatform();
    await reachSource();
    commit("bp-count", "5");
    commit("bp-rounding", "down");
    expect(breakpointPolicyFromForm()).toEqual({ count: 5, mode: "limit", rounding: "down" });
  });

  test("Keep all hides both value controls and asks for every declared width", async () => {
    setKey();
    importPlatform();
    await reachSource();
    commit("bp-mode", "all");
    await flush(2);
    expect(npPart("bp-count")).toBeNull();
    expect(npPart("bp-widths")).toBeNull();
    expect(npPart("bp-rounding")).toBeNull();
    expect(breakpointPolicyFromForm()).toEqual({ mode: "all" });
  });

  test("Custom widths takes a list, and keeps the rounding rule that matches it to the site", async () => {
    setKey();
    importPlatform();
    await reachSource();
    commit("bp-mode", "explicit");
    await flush(2);
    expect(npPart("bp-widths")).toBeTruthy();
    npType(control("bp-widths"), " 640 , 1024,1440 ");
    commit("bp-rounding", "up");

    expect(breakpointPolicyFromForm()).toEqual({
      mode: "explicit",
      rounding: "up",
      widths: [640, 1024, 1440],
    });
  });

  test("a half-typed width list still means the default, not nothing", async () => {
    setKey();
    importPlatform();
    await reachSource();
    commit("bp-mode", "explicit");
    await flush(2);
    npType(control("bp-widths"), "six hundred");
    expect(breakpointPolicyFromForm()).toEqual({ count: 3, mode: "limit", rounding: "nearest" });
  });

  test("the policy rides the brief the assistant reads", async () => {
    setKey();
    importPlatform();
    await reachParams();
    npFillLocation();
    await flush();
    npType(npName(), "Cloned Site");
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(pendingImportBrief()?.breakpoints).toEqual({
      count: 3,
      mode: "limit",
      rounding: "nearest",
    });
  });

  test("the crawl-depth field reaches the depth the backend actually accepts", async () => {
    // It said 2 while `import_site` and the endpoint both clamped to 5, so the wizard could not ask
    // For a depth the pipeline was willing to run.
    setKey();
    importPlatform();
    await reachSource();
    expect(control("depth").getAttribute("max")).toBe("5");
  });
});
