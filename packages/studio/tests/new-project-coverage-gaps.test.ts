/**
 * Coverage-gap tests for the New Project wizard and the Add Existing Repository picker:
 *
 * - New-project: the credentials-gate re-render callbacks, the Template context label, starter
 *   selection + missing-selection validation, the busy guards on Back/tab-change, the agent
 *   submit's directory derivation + failure surface, and the destination fields surviving a
 *   Back/Next round-trip.
 * - Add-repo-modal: double-open, double-import, import-less platforms, and Escape dismissal.
 *
 * Both are documents in the dialog layer now, so everything on screen is addressed by `part`.
 */
import {
  clearSeededSettings,
  flush,
  installMockPlatform,
  mountOverlayLayers,
  npCards,
  npDialog,
  npDismiss,
  npFillLocation,
  npFooter,
  npLocation,
  npName,
  npPart,
  npPickTab,
  npPress,
  npPreview,
  npSlug,
  npType,
  seedSettings,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RepoInfo, StarterInfo } from "../src/types";

const { openNewProjectModal } = await import("../src/new-project/new-project-modal");
const { openAddRepoModal } = await import("../src/new-project/add-repo-modal");
const { initLayers } = await import("../src/ui/layers");

mountOverlayLayers(document.body);
initLayers();

function click(el: Element | null | undefined): void {
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function errorText(): string | null {
  return npPart("failure")?.textContent?.trim() ?? null;
}

function contextText(): string | null {
  return npPart("context")?.textContent?.trim() ?? null;
}

/** The native control inside one of the wizard's fields. */
function control(part: string): HTMLInputElement {
  return npPart(part)?.querySelector('[part="input"], [part="control"]') as HTMLInputElement;
}

const STARTERS: StarterInfo[] = [
  {
    accent: "#3b82f6",
    description: "d1",
    features: [],
    id: "portfolio",
    industry: "General",
    name: "Portfolio",
    tagline: "Show your work",
    thumbnail: "",
  },
  {
    accent: "#10b981",
    description: "d2",
    features: [],
    id: "bakery",
    industry: "Food",
    name: "Bakery",
    tagline: "Fresh daily",
    thumbnail: "",
  },
];

beforeEach(() => {
  localStorage.clear();
  clearSeededSettings();
});

afterEach(() => {
  npDismiss();
  dismissPicker();
});

/**
 * Put the repo picker away the way a reader does: the platform's `cancel`, which is what Escape
 * raises on a modal `<dialog>` and what the kit's Cancel button dispatches. A no-op when the picker
 * is not up — the flow exported a closer only while it drew its own box.
 */
function dismissPicker(): void {
  document
    .querySelector('#layer-dialog jx-dialog[part="add-repo"]')
    ?.dispatchEvent(new Event("cancel", { bubbles: true }));
}

describe("new-project wizard gaps", () => {
  test("saving a key through the agent gate re-renders past it", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    /* Six turns: the credentials form is a mounted Jx document of its own, placed into the box the
       wizard renders empty, so it is not there on the turn the gate renders. */
    await flush(6);
    const creds = npPart("ai-creds-form");
    expect(creds).toBeTruthy();

    const keyInput = creds!.querySelector('[part="key"] [part="input"]') as HTMLInputElement;
    keyInput.value = "sk-fresh-key";
    keyInput.dispatchEvent(new Event("input", { bubbles: true }));
    click(creds!.querySelector('[part="save"]'));
    await flush(3);

    // The gate lifted: the prompt field replaced the credentials form.
    expect(npPart("ai-creds-form")).toBeNull();
    expect(npPart("prompt")).toBeTruthy();
  });

  test("the Name step labels the scratch source when no starters exist", async () => {
    installMockPlatform(); // No listStarters → the scratch card is the whole gallery.
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    expect(contextText()).toBe("Start from scratch");
    // Nothing blocks Next: there is always a valid selection.
    expect(errorText()).toBeNull();
  });

  test("starter cards select on click and label the Name step", async () => {
    installMockPlatform({ listStarters: async () => STARTERS });
    void openNewProjectModal();
    await flush(4);
    // Two starters plus the trailing scratch card.
    expect(npCards()).toHaveLength(3);
    click(npCards()[1]);
    await flush(2);
    expect(npCards()[1]!.dataset.selected).toBeDefined();

    npPress("Confirm");
    await flush(2);
    expect(contextText()).toContain("Starter site · Bakery");
    // Step 2 is Name + Location only — the description field left with the design quickstart.
    expect(npPart("name-row")?.querySelector('[part="label"]')?.textContent).toBe("Project Name");
    expect(npPart("location-row")?.querySelector('[part="label"]')?.textContent).toBe("Location");
  });

  test("Back and tab switches are ignored while a create is in flight", async () => {
    let releaseCreate: () => void = () => {};
    installMockPlatform({
      createProject: (async () => {
        await new Promise<void>((resolve) => {
          releaseCreate = resolve;
        });
        return { config: { name: "Slow Site" }, root: "/projects/slow-site" };
      }) as never,
    });
    const promise = openNewProjectModal();
    await flush(3);
    const staleTabs = npPart("tabs")!;
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Slow Site");
    await flush();
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush();
    expect(npFooter()).toContain("Creating…");

    npPress("Back"); // Guarded: the wizard must stay on the Name step.
    await flush(2);
    expect(npPart("name")).toBeTruthy();

    // A stale tab strip cannot hijack the flow mid-create; the strip is off screen on this step.
    staleTabs.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: "agent" }));
    await flush(2);
    expect(npPart("name")).toBeTruthy();

    releaseCreate();
    expect(await promise).toEqual({
      config: { name: "Slow Site" },
      root: "/projects/slow-site",
    } as never);
  });

  test("agent submit derives a blank directory and surfaces create failures", async () => {
    seedSettings({ "jx.ai.openaiKey": "sk-agent-test" });
    const attempts: Record<string, unknown>[] = [];
    installMockPlatform({
      createProject: (async (opts: Record<string, unknown>) => {
        attempts.push(opts);
        throw new Error("quota exceeded for this account");
      }) as never,
    });
    void openNewProjectModal();
    await flush(3);
    npPickTab("agent");
    await flush(3);
    npType(control("prompt"), "A tiny site");
    npPress("Confirm");
    await flush(3);
    npType(npName(), "Failing Agent Site");
    await flush();
    npType(npSlug(), ""); // Clear the derived directory — submit must re-derive it.
    await flush();
    npFillLocation("/home/dev/Sites");
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(attempts[0]).toMatchObject({
      destination: { kind: "path", parent: "/home/dev/Sites" },
      directory: "failing-agent-site",
      name: "Failing Agent Site",
      template: "blank",
    });
    expect(errorText()).toContain("quota exceeded");
  });

  test("the chosen Location survives a Back → Next round-trip", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Round Trip");
    await flush();
    npFillLocation("/home/dev/Sites");
    await flush();
    expect(npPreview()).toContain("/home/dev/Sites/round-trip");

    npPress("Back");
    await flush(2);
    expect(npPart("location")).toBeNull();
    npPress("Confirm");
    await flush(2);

    // The destination fields keep the user's edits, like the rest of the second step.
    expect(npLocation().value).toBe("/home/dev/Sites");
    expect(npSlug().value).toBe("round-trip");
    expect(npPreview()).toContain("/home/dev/Sites/round-trip");
  });

  test("closing the wizard takes its dialog out of the layer", async () => {
    installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    expect(npDialog()).toBeTruthy();
    npDismiss();
    expect(await promise).toBeNull();
    await flush();
    expect(npDialog()).toBeNull();
  });
});

describe("add-repo modal gaps", () => {
  const REPOS: RepoInfo[] = [
    {
      defaultBranch: "main",
      fullName: "octocat/site",
      isJxProject: true,
      name: "site",
      owner: "octocat",
      permission: "admin",
      private: true,
    },
    {
      defaultBranch: "trunk",
      fullName: "acme/marketing",
      isJxProject: false,
      name: "marketing",
      owner: "acme",
      permission: "write",
      private: false,
    },
  ];

  /* The picker is a document in the dialog layer now, so its rows are addressed by `part` and the
     dialog itself is the `jx-dialog` — `.add-repo-row` and the `sp-underlay` card it sat in are
     both gone (`src/surfaces/add-repo.json`). */
  function rows(): HTMLButtonElement[] {
    return [...document.querySelectorAll('#layer-dialog [part="row"]')] as HTMLButtonElement[];
  }

  function picker(): HTMLElement | null {
    return document.querySelector('#layer-dialog jx-dialog[part="add-repo"]');
  }

  test("a second open while the picker is up resolves null immediately", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "octocat/site@main" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const first = openAddRepoModal();
    await flush(3);
    expect(await openAddRepoModal()).toBeNull();
    dismissPicker();
    expect(await first).toBeNull();
  });

  test("clicking another repo while an import runs is ignored", async () => {
    let releaseImport: () => void = () => {};
    let imports = 0;
    installMockPlatform({
      importProject: (() => {
        imports += 1;
        return new Promise((resolve) => {
          releaseImport = () => resolve({ root: "octocat/site@main" });
        });
      }) as never,
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    rows()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    // The row that is running says so itself, and every row goes quiet while it does.
    expect(rows()[0]!.textContent).toContain("Importing…");
    expect(rows()[1]!.disabled).toBe(true);
    rows()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(imports).toBe(1);
    releaseImport();
    expect(await promise).toEqual({ root: "octocat/site@main" });
  });

  test("platforms that cannot import surface the inline notice", async () => {
    installMockPlatform({ listRepos: () => Promise.resolve(REPOS) });
    const promise = openAddRepoModal();
    await flush(3);
    rows()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(document.querySelector('#layer-dialog [part="failure"]')?.textContent).toContain(
      "cannot import repositories",
    );
    dismissPicker();
    expect(await promise).toBeNull();
  });

  test("Escape dismisses the picker", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    /* Escape on a modal `<dialog>` is the platform's: it closes the dialog and raises `cancel`,
       which is the same event the kit's own Cancel button dispatches. */
    picker()!.dispatchEvent(new Event("cancel", { bubbles: true }));
    await flush();
    expect(picker()).toBeNull();
    expect(await promise).toBeNull();
  });
});
