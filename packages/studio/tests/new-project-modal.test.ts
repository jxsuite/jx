/**
 * New Project wizard tests — `src/new-project/new-project-modal.ts` (the flow) and
 * `src/surfaces/new-project.json` (the dialog it draws into): the source tab strip, the starter
 * gallery and its single "Start from scratch" card, the Next/Back/Cancel transitions, the Name +
 * Location step with directory-slug derivation, the destination block (Location + Browse…, on a
 * `createDestination: "path"` platform), validation, platform createProject success/failure, and
 * the dismissal paths.
 *
 * Everything is addressed by `part`, because the wizard is a document: there is no
 * `.new-project-modal` to find any more, and no `.new-project-template` either — the box, the
 * backdrop, Escape, the headline and all three footer buttons belong to `jx-dialog`, which is why
 * the wizard now lives in `#layer-dialog` rather than in the modal layer beside an `<sp-underlay>`
 * it painted itself.
 */
import {
  flush,
  installMockPlatform,
  npCards,
  npDialog,
  npDismiss,
  npFillLocation,
  npFooter,
  npHeadline,
  npLocation,
  npName,
  npPart,
  npParts,
  npPickTab,
  npPress,
  npPreview,
  npSlug,
  npTabValues,
  npType,
  mountOverlayLayers,
} from "./harness";
import { afterEach, describe, expect, test } from "bun:test";

const { openNewProjectModal } = await import("../src/new-project/new-project-modal");
const { initLayers } = await import("../src/ui/layers");

mountOverlayLayers(document.body);
initLayers();

function click(el: Element | null | undefined): void {
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The global backend-failure strip at the foot of the body. */
function errorText(): string | null {
  return npPart("failure")?.textContent?.trim() ?? null;
}

/** The inline destination-validation message rendered under the Location/Directory fields. */
function destinationError(): string | null {
  return npPart("destination-failure")?.textContent?.trim() ?? null;
}

/** The Browse… button beside the Location field (absent without `platform.pickDirectory`). */
function browseButton(): HTMLButtonElement | null {
  return npPart("browse")?.querySelector<HTMLButtonElement>('[part="control"]') ?? null;
}

/** The inline validation message under the Project Name field. */
function nameError(): string | null {
  return npPart("name-failure")?.textContent?.trim() ?? null;
}

/** The source context line on the second step. */
function contextText(): string {
  return npPart("context")?.textContent?.trim() ?? "";
}

const SAMPLE_STARTERS = [
  {
    accent: "#b45309",
    description: "Full description of the bistro starter.",
    features: ["Menu collection"],
    id: "restaurant",
    industry: "Restaurant & Food",
    name: "Bistro & Café",
    tagline: "A menu-driven site.",
    thumbnail: "data:image/png;base64,AAAA",
  },
  {
    description: "A shop.",
    features: [],
    id: "shop",
    industry: "Retail",
    name: "Corner Shop",
    tagline: "Products and a cart.",
    thumbnail: "data:image/png;base64,BBBB",
  },
];

/** Whether a gallery card is the chosen one. The document says so with an attribute, not a class. */
function chosen(card: HTMLElement | undefined): boolean {
  return card?.dataset.selected !== undefined;
}

afterEach(() => {
  localStorage.clear();
  npDismiss();
});

describe("openNewProjectModal — wizard lifecycle", () => {
  test("step 1 names the step and offers the gallery; Next reveals Name + Location", async () => {
    installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    expect(npDialog()).toBeTruthy();
    expect(npHeadline()).toBe("Choose a starting point");
    // No importSite on the default mock platform → the Import tab is hidden.
    expect(npTabValues()).toEqual(["starter", "agent"]);
    // The source step carries no parameter fields — they live on step 2.
    expect(npParts("name")).toHaveLength(0);
    expect(npFooter()).toEqual(["Cancel", "Next"]);

    npPress("Confirm");
    await flush(2);
    expect(npHeadline()).toBe("Name your project");
    expect(contextText()).toContain("Start from scratch");
    // Name + Location + Directory, and nothing else: no URL, no adapter, no design quickstart.
    expect(npParts("url")).toHaveLength(0);
    expect(npName()).toBeTruthy();
    expect(npLocation()).toBeTruthy();
    expect(npSlug()).toBeTruthy();
    expect(npPart("visibility")).toBeNull();
    expect(npPart("footnote")?.textContent).toContain("project settings");
    // The tab strip is hidden on the Name step.
    expect(npPart("tabs")).toBeNull();
    expect(npFooter()).toEqual(["Back", "Cancel", "Create Project"]);

    // Back returns to the source step with the tabs restored.
    npPress("Back");
    await flush(2);
    expect(npPart("tabs")).toBeTruthy();

    npDismiss();
    await flush();
    expect(npDialog()).toBeNull();
    return expect(promise).resolves.toBeNull();
  });

  test("the dialog is the kit's, headline and all — nothing here draws a box", async () => {
    installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    expect(npDialog()?.querySelector('dialog[part="dialog"]')).toBeTruthy();
    expect(document.querySelector("#layer-modal sp-underlay")).toBeNull();
    expect(document.querySelector("#layer-modal .new-project-modal")).toBeNull();
    // The shot manifest addresses the wizard by this region, on the one node that has a box.
    expect(npDialog()?.querySelector('[data-jx-region="overlay.dialog:new-project"]')).toBeTruthy();
    /* The platform actually opened it. Worth asserting rather than assuming: `jx-ready` BUBBLES,
       and the tab strip inside this dialog announces itself with it — so before `whenReady` learned
       to ignore a descendant's, `showModal` ran one microtask early, found no `<dialog>` and did
       nothing at all, leaving a fully drawn wizard that never showed. */
    expect(npDialog()?.dataset.open).toBeDefined();
    npDismiss();
    expect(await promise).toBeNull();
  });

  test("shows the Import tab when the platform supports importSite", async () => {
    installMockPlatform({
      importSite: (async () => ({ config: {}, root: "/r" })) as never,
    });
    void openNewProjectModal();
    await flush(3);
    expect(npTabValues()).toEqual(["starter", "import", "agent"]);
  });

  test("a second open while one is active resolves null immediately", async () => {
    installMockPlatform();
    const first = openNewProjectModal();
    await flush(3);
    expect(await openNewProjectModal()).toBeNull();
    expect(npDialog()).toBeTruthy();
    npDismiss();
    expect(await first).toBeNull();
  });

  test("dismissing when nothing is open is a no-op", () => {
    /* No exported closer any more: every way out of the wizard is the platform's `cancel`, and
       this is a no-op with nothing up. See the module docblock in
       `src/new-project/new-project-modal.ts`. */
    expect(npDialog()).toBeNull();
    npDismiss();
    expect(npDialog()).toBeNull();
  });

  test("Cancel works from the source step", async () => {
    installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    npPress("Cancel");
    expect(await promise).toBeNull();
    await flush();
    expect(npDialog()).toBeNull();
  });

  test("Cancel works from the Name step too", async () => {
    installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    expect(npFooter()).toContain("Cancel");
    npPress("Cancel");
    expect(await promise).toBeNull();
  });

  test("Escape — the platform's own cancel — dismisses it", async () => {
    installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    npDismiss();
    expect(await promise).toBeNull();
    await flush();
    expect(npDialog()).toBeNull();
  });
});

describe("openNewProjectModal — the starter gallery", () => {
  test("offers only the scratch card when the platform ships no starters", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    expect(npCards()).toHaveLength(1);
    expect(npCards()[0]!.textContent).toContain("Start from scratch");
    expect(chosen(npCards()[0])).toBe(true);
    // The four breakpoint templates are gone.
    expect(npDialog()?.textContent).not.toContain("Desktop First");
    expect(npDialog()?.textContent).not.toContain("breakpoints");
  });

  test("starters lead, with the first selected and the scratch card last", async () => {
    installMockPlatform({ listStarters: (async () => SAMPLE_STARTERS) as never });
    void openNewProjectModal();
    await flush(4);
    const all = npCards();
    expect(all).toHaveLength(3);
    expect(all[0]!.textContent).toContain("Bistro & Café");
    expect(chosen(all[0])).toBe(true);
    expect(all[1]!.textContent).toContain("Corner Shop");
    expect(all[2]!.textContent).toContain("Start from scratch");
    expect(chosen(all[2])).toBe(false);
    // A starter card carries its picture; the scratch card carries the blank well instead.
    expect(all[0]!.querySelector('[part="thumb"]')).toBeTruthy();
    expect(all[2]!.querySelector('[part="blank"]')).toBeTruthy();
  });

  test("an arriving starter list does not override a card the user already picked", async () => {
    let release: (v: unknown) => void = () => {};
    installMockPlatform({
      listStarters: (() =>
        new Promise((resolve) => {
          release = resolve;
        })) as never,
    });
    void openNewProjectModal();
    await flush(3);
    // Scratch is the only card until the list lands; pick it explicitly.
    click(npCards()[0]);
    release(SAMPLE_STARTERS);
    await flush(3);
    const all = npCards();
    expect(all).toHaveLength(3);
    expect(chosen(all[0])).toBe(false);
    expect(chosen(all[2])).toBe(true);
  });

  test("selecting a starter threads its id into createProject", async () => {
    const { state } = installMockPlatform({
      listStarters: (async () => SAMPLE_STARTERS) as never,
    });
    void openNewProjectModal();
    await flush(4);
    click(npCards()[1]);
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(contextText()).toContain("Corner Shop");

    npType(npName(), "My Diner");
    await flush();
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush(2);
    const call = state.calls.find((c) => c[0] === "createProject");
    expect(call?.[1]).toMatchObject({ name: "My Diner", starter: "shop" });
    expect((call![1] as { template?: string }).template).toBeUndefined();
  });

  test("the scratch card creates the blank template", async () => {
    const { state } = installMockPlatform({
      listStarters: (async () => SAMPLE_STARTERS) as never,
    });
    void openNewProjectModal();
    await flush(4);
    click(npCards()[2]);
    await flush();
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Empty Site");
    await flush();
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush(2);
    const call = state.calls.find((c) => c[0] === "createProject");
    expect(call?.[1]).toMatchObject({ name: "Empty Site", template: "blank" });
    expect((call![1] as { starter?: string }).starter).toBeUndefined();
  });

  test("openNewProjectModal({ tab: 'starter' }) opens on the gallery", async () => {
    installMockPlatform({ listStarters: (async () => SAMPLE_STARTERS) as never });
    void openNewProjectModal({ tab: "starter" });
    await flush(4);
    expect(npPart("tabs")?.dataset.selection).toBe("starter");
    expect(npCards()[0]?.textContent).toContain("Bistro & Café");
  });

  test("a failing listStarters leaves the gallery usable", async () => {
    installMockPlatform({
      listStarters: (async () => {
        throw new Error("nope");
      }) as never,
    });
    void openNewProjectModal();
    await flush(4);
    expect(npDialog()).toBeTruthy();
    expect(npCards()).toHaveLength(1);
    expect(chosen(npCards()[0])).toBe(true);
  });

  test("switching tabs and back keeps the gallery", async () => {
    installMockPlatform({ listStarters: (async () => SAMPLE_STARTERS) as never });
    void openNewProjectModal();
    await flush(4);
    npPickTab("agent");
    await flush(2);
    expect(npCards()).toHaveLength(0);
    npPickTab("starter");
    await flush(2);
    expect(npCards()).toHaveLength(3);
  });
});

describe("openNewProjectModal — directory derivation", () => {
  test("derives a slug from the project name while directory is untouched", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "My Cool Site!");
    await flush();
    expect(npSlug().value).toBe("my-cool-site");
    npType(npName(), "Renamed Site");
    await flush();
    expect(npSlug().value).toBe("renamed-site");
  });

  test("manual directory entry stops further derivation", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npSlug(), "custom-dir");
    await flush();
    npType(npName(), "Some Project");
    await flush();
    expect(npSlug().value).toBe("custom-dir");
  });
});

describe("openNewProjectModal — destination", () => {
  test("blocks create with an inline error when the Location is empty", async () => {
    const { state } = installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Homeless Site");
    await flush();
    npPress("Confirm");
    await flush(2);

    // The destination message replaces the name error and the wizard stays open for a fix.
    expect(destinationError()).toBe("Choose a location for the project folder");
    expect(nameError()).toBeNull();
    expect(npDialog()).toBeTruthy();
    expect(state.calls.filter((c) => c[0] === "createProject")).toHaveLength(0);
  });

  test("rejects a relative Location as not an absolute path", async () => {
    const { state } = installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Relative Site");
    await flush();
    npType(npLocation(), "sites/relative");
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(destinationError()).toBe("Location must be an absolute path");
    expect(npDialog()).toBeTruthy();
    expect(state.calls.filter((c) => c[0] === "createProject")).toHaveLength(0);
  });

  test("typing a Location clears the inline destination error", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Fixable Site");
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(destinationError()).toBe("Choose a location for the project folder");
    npFillLocation();
    await flush(2);
    expect(destinationError()).toBeNull();
  });

  test("the preview tracks the location and the slug", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    // Both halves are still unknown before anything is typed.
    expect(npPreview()).toBe("Creates: …/…");

    npType(npName(), "My Cool Site");
    await flush();
    expect(npPreview()).toBe("Creates: …/my-cool-site");

    // A trailing separator on the typed location is not doubled up.
    npFillLocation("/home/dev/Sites/");
    await flush();
    expect(npPreview()).toBe("Creates: /home/dev/Sites/my-cool-site");

    npType(npSlug(), "cool-dir");
    await flush();
    expect(npPreview()).toBe("Creates: /home/dev/Sites/cool-dir");
  });

  test("createProject receives the typed Location as a path destination", async () => {
    const { state } = installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Placed Site");
    await flush();
    npFillLocation("/home/dev/Sites/");
    await flush();
    npPress("Confirm");

    const result = await promise;
    const call = state.calls.find((c) => c[0] === "createProject") as unknown[];
    expect((call[1] as { destination: unknown }).destination).toEqual({
      kind: "path",
      parent: "/home/dev/Sites",
    });
    expect((call[1] as { directory: string }).directory).toBe("placed-site");
    // The mock scaffolds under exactly the parent the user named.
    expect(result?.root).toBe("/home/dev/Sites/placed-site");
  });

  test("no Browse… button when the platform cannot open a directory dialog", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    expect(browseButton()).toBeNull();
    expect(npLocation().getAttribute("placeholder")).toBe("/absolute/path/to/your/projects");
  });

  test("Browse… fills the Location from pickDirectory", async () => {
    let picks = 0;
    let release: (value: string | null) => void = () => {};
    installMockPlatform({
      pickDirectory: (() => {
        picks += 1;
        return new Promise<string | null>((resolve) => {
          release = resolve;
        });
      }) as never,
    });
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    expect(npLocation().getAttribute("placeholder")).toBe(
      "Choose a folder to create the project in",
    );
    expect(browseButton()).toBeTruthy();

    click(browseButton());
    await flush();
    // While the native dialog is open the button is busy and further clicks are ignored.
    expect(npPart("browse")?.textContent).toContain("Choosing…");
    expect(browseButton()?.hasAttribute("disabled")).toBe(true);
    click(browseButton());
    release("/Users/dev/Projects");
    await flush(2);

    expect(picks).toBe(1);
    expect(npLocation().value).toBe("/Users/dev/Projects");
    expect(npPreview()).toBe("Creates: /Users/dev/Projects/…");
    expect(npPart("browse")?.textContent).toContain("Browse…");
    expect(browseButton()?.hasAttribute("disabled")).toBe(false);
  });

  test("a cancelled Browse… leaves the typed Location untouched", async () => {
    installMockPlatform({ pickDirectory: (async () => null) as never });
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npFillLocation("/home/dev/Sites");
    await flush();

    click(browseButton());
    await flush(3);

    expect(npLocation().value).toBe("/home/dev/Sites");
    expect(npPreview()).toBe("Creates: /home/dev/Sites/…");
  });
});

describe("openNewProjectModal — submit", () => {
  test("rejects an empty project name with an inline error at the field", async () => {
    const { state } = installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npPress("Confirm");
    await flush(2);
    // The message renders under the name field, not in the global strip.
    expect(nameError()).toBe("Project name is required");
    expect(npName().getAttribute("aria-invalid")).toBe("true");
    // The name is checked before the destination, so no location complaint yet.
    expect(destinationError()).toBeNull();
    expect(errorText()).toBeNull();
    expect(npDialog()).toBeTruthy();
    expect(state.calls.filter((c) => c[0] === "createProject")).toHaveLength(0);
  });

  test("typing into the name field clears the inline error", async () => {
    installMockPlatform();
    void openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npPress("Confirm");
    await flush(2);
    expect(nameError()).toBe("Project name is required");
    npType(npName(), "My Site");
    await flush(2);
    expect(nameError()).toBeNull();
    expect(npName().getAttribute("aria-invalid")).toBeNull();
  });

  test("creates the project, shows progress, initialises git, and resolves", async () => {
    let resolveCreate: (v: unknown) => void = () => {};
    const created: unknown[] = [];
    const { state } = installMockPlatform({
      createProject: ((opts: unknown) => {
        created.push(opts);
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }) as never,
    });

    const promise = openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "My Site");
    await flush();
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush();

    // While createProject is pending the primary says so, and pressing it again starts nothing.
    expect(npFooter()).toEqual(["Back", "Cancel", "Creating…"]);
    npPress("Confirm");
    await flush();
    expect(created).toHaveLength(1);

    resolveCreate({ config: { name: "My Site" }, root: "/home/dev/Sites/my-site" });
    const result = await promise;
    expect(result).toEqual({
      config: { name: "My Site" },
      root: "/home/dev/Sites/my-site",
    } as never);
    await flush();
    expect(npDialog()).toBeNull();
    // Name + Location only — no url, adapter, description or design in the payload.
    expect(created[0]).toEqual({
      destination: { kind: "path", parent: "/home/dev/Sites" },
      directory: "my-site",
      name: "My Site",
      template: "blank",
    });
    // A scaffold is not a repository, so the create path makes it one.
    expect(state.calls.map((c) => c[0])).toContain("gitInit");
  });

  test("re-derives the directory at submit time when it was cleared", async () => {
    const { state } = installMockPlatform();
    const promise = openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Site X");
    await flush();
    npType(npSlug(), ""); // User clears the derived value
    await flush();
    npFillLocation();
    await flush();
    npPress("Confirm");
    await promise;
    const call = state.calls.find((c) => c[0] === "createProject") as unknown[];
    expect((call[1] as { directory: string }).directory).toBe("site-x");
  });

  test("createProject failure surfaces the error and keeps the wizard open", async () => {
    installMockPlatform({
      createProject: (async () => {
        throw new Error("disk full");
      }) as never,
    });
    let settled = false;
    const promise = openNewProjectModal();
    void promise.then(() => {
      settled = true;
    });
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Doomed");
    await flush();
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(npDialog()).toBeTruthy();
    expect(errorText()).toContain("disk full");
    // Button returns to its idle state for a retry
    expect(npFooter()).toEqual(["Back", "Cancel", "Create Project"]);
    expect(settled).toBe(false);

    npDismiss();
    expect(await promise).toBeNull();
  });

  test("a structured needs_installation_access failure renders the install link", async () => {
    const installUrl = "https://github.com/apps/jx-suite/installations/new";
    installMockPlatform({
      createProject: (async () => {
        throw Object.assign(new Error("GitHub blocked repository creation."), {
          code: "needs_installation_access",
          installUrl,
        });
      }) as never,
    });
    const promise = openNewProjectModal();
    await flush(3);
    npPress("Confirm");
    await flush(2);
    npType(npName(), "Blocked");
    await flush();
    npFillLocation();
    await flush();
    npPress("Confirm");
    await flush(2);

    expect(errorText()).toContain("blocked repository creation");
    const link = npPart<HTMLAnchorElement>("install");
    expect(link?.getAttribute("href")).toBe(installUrl);
    expect(link?.textContent).toContain("Install the Jx Suite GitHub App");

    npDismiss();
    expect(await promise).toBeNull();
  });
});
