/**
 * The destination half of the New Project wizard's second step (specs/desktop.md §4.5).
 *
 * The wizard suite exercises the `"path"` shape end-to-end; this file drives `location-fields.ts`
 * directly so the `"repo"` shape — which only the cloud platform selects — is covered too, along
 * with the owner-loading, collision-hint and separator edge cases, and then opens the wizard once
 * on a repo platform so the document's own branch is drawn rather than only projected.
 *
 * The projection is what a test reads now: `locationView()` is the record the document renders
 * from, so "the owner field is a picker" is `owners.length > 0` here and a `[part="owner"]` that is
 * a `jx-select` there. There is no `.new-project-owner` to find — the module draws nothing.
 */
import {
  flush,
  installMockPlatform,
  mountOverlayLayers,
  npDismiss,
  npName,
  npPart,
  npPress,
  npSlug,
  npType,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RepoInfo, StudioPlatform } from "../src/types";

const {
  browseLocation,
  collectDestination,
  destinationPath,
  loadLocationOptions,
  locationError,
  locationView,
  resetLocationFields,
  setLocationOwner,
  setLocationParent,
  setLocationVisibility,
  slugFieldLabel,
} = await import("../src/new-project/location-fields");
const { openNewProjectModal } = await import("../src/new-project/new-project-modal");
const { initLayers } = await import("../src/ui/layers");

mountOverlayLayers(document.body);
initLayers();

const REPOS: RepoInfo[] = [
  {
    defaultBranch: "main",
    fullName: "acme/site",
    isJxProject: true,
    name: "site",
    owner: "acme",
    permission: "admin",
    private: true,
  },
  {
    defaultBranch: "main",
    fullName: "zoe/blog",
    isJxProject: false,
    name: "blog",
    owner: "zoe",
    permission: "write",
    private: false,
  },
];

/** Install a repo-destination platform (the cloud shape), with optional owner sources. */
function installRepoPlatform(overrides: Partial<StudioPlatform> = {}) {
  return installMockPlatform({ createDestination: "repo", ...overrides });
}

beforeEach(() => {
  resetLocationFields();
});

afterEach(() => {
  npDismiss();
});

// ─── Path destinations ────────────────────────────────────────────────────────

describe("path destinations", () => {
  test("labels the slug field Directory and refuses an unset location", () => {
    installMockPlatform({ createDestination: "path" });
    expect(slugFieldLabel()).toBe("Directory");
    expect(collectDestination("my-site")).toBeNull();
    expect(locationError()).toBe("Choose a location for the project folder");
    expect(locationView("my-site").error).toBe("Choose a location for the project folder");
  });

  test("the view says which shape to draw, and what the Location field offers", () => {
    installMockPlatform({ createDestination: "path" });
    const view = locationView("my-site");
    expect(view.destination).toBe("path");
    expect(view.slugLabel).toBe("Directory");
    expect(view.previewLabel).toBe("Creates");
    expect(view.preview).toBe("…/my-site");
    // No native dialog on this platform, so the path is typed and the hint says so.
    expect(view.canBrowse).toBe(false);
    expect(view.parentPlaceholder).toBe("/absolute/path/to/your/projects");
  });

  test("a platform with a directory dialog offers Browse…, and says so while it is open", async () => {
    let release: (value: string | null) => void = () => {};
    let picks = 0;
    installMockPlatform({
      createDestination: "path",
      pickDirectory: (() => {
        picks += 1;
        return new Promise<string | null>((resolve) => {
          release = resolve;
        });
      }) as never,
    });
    expect(locationView("s").canBrowse).toBe(true);
    expect(locationView("s").browseLabel).toBe("Browse…");

    let repaints = 0;
    const run = browseLocation(() => {
      repaints += 1;
    });
    expect(locationView("s").browsing).toBe(true);
    expect(locationView("s").browseLabel).toBe("Choosing…");
    // A second press while the native dialog is up asks for nothing.
    await browseLocation(() => {});
    expect(picks).toBe(1);

    release("/Users/dev/Projects");
    await run;
    expect(locationView("s").browsing).toBe(false);
    expect(locationView("s").parent).toBe("/Users/dev/Projects");
    expect(repaints).toBe(2);
  });

  test("a cancelled Browse… leaves the typed Location untouched", async () => {
    installMockPlatform({
      createDestination: "path",
      pickDirectory: (async () => null) as never,
    });
    setLocationParent("/home/dev/Sites");
    await browseLocation(() => {});
    expect(locationView("s").parent).toBe("/home/dev/Sites");
  });

  test("browseLocation is a no-op on a platform with no directory dialog", async () => {
    installMockPlatform({ createDestination: "path" });
    let repaints = 0;
    await browseLocation(() => {
      repaints += 1;
    });
    expect(repaints).toBe(0);
    expect(locationView("s").parent).toBe("");
  });

  test("destinationPath joins with the parent's own separator", () => {
    expect(destinationPath({ kind: "path", parent: "/home/dev/Sites" }, "my-site")).toBe(
      "/home/dev/Sites/my-site",
    );
    // A Windows-style parent keeps backslashes rather than acquiring a mixed separator.
    expect(destinationPath({ kind: "path", parent: String.raw`C:\Sites` }, "my-site")).toBe(
      String.raw`C:\Sites\my-site`,
    );
  });

  test("destinationPath does not double a separator the parent already ends with", () => {
    expect(destinationPath({ kind: "path", parent: "/" }, "my-site")).toBe("/my-site");
  });

  test("destinationPath flattens a repo destination to owner/repo", () => {
    /* It used to THROW here, on the premise that only a filesystem platform imports. A hosted
       backend imports into a repository it creates, and `importSite` takes one `directory` string
       for every platform — so the repo shape has to flatten to the name that backend can act on
       rather than to an exception the Import tab would hit on its first hand-off. */
    expect(
      destinationPath({ kind: "repo", owner: "acme", private: true, repo: "site" }, "site"),
    ).toBe("acme/site");
  });

  test("destinationPath falls back to the slug when the repo name is empty", () => {
    /* `collectDestination` fills `repo` from the slug, so the two agree in the wizard. A caller
       that built the destination itself must still get the name the user typed, not "acme/". */
    expect(
      destinationPath({ kind: "repo", owner: "acme", private: false, repo: "" }, " site "),
    ).toBe("acme/site");
  });
});

// ─── Repo destinations ────────────────────────────────────────────────────────

describe("repo destinations", () => {
  test("labels the slug field Repository", () => {
    installRepoPlatform();
    expect(slugFieldLabel()).toBe("Repository");
    expect(locationView("my-site").slugLabel).toBe("Repository");
  });

  test("refuses a missing owner, then a missing repository name", () => {
    installRepoPlatform();
    expect(collectDestination("my-site")).toBeNull();
    expect(locationError()).toBe("Choose an owner for the repository");
  });

  test("collects owner, repo, and visibility once an owner is chosen", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    loadLocationOptions(() => {});
    await flush();

    // The first owner alphabetically is selected by default so the field is never empty.
    const destination = collectDestination("my-site");
    expect(destination).toEqual({ kind: "repo", owner: "acme", private: true, repo: "my-site" });
    expect(locationError()).toBe("");
  });

  test("an empty repository name is refused once an owner exists", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    loadLocationOptions(() => {});
    await flush();

    expect(collectDestination("  ")).toBeNull();
    expect(locationError()).toBe("Repository name is required");
  });

  test("owners merge account installations and repo owners, sorted and deduped", async () => {
    installRepoPlatform({
      getAccountStatus: async () => ({
        installations: [
          { account: "zoe", id: 1 },
          { account: null, id: 2 },
          { account: "beta-org", id: 3 },
        ],
      }),
      listRepos: async () => REPOS,
    });
    let rerenders = 0;
    loadLocationOptions(() => {
      rerenders += 1;
    });
    await flush();
    expect(rerenders).toBe(1);

    // "zoe" appears in both sources and must not be duplicated.
    expect(locationView("my-site").owners).toEqual([
      { label: "acme", value: "acme" },
      { label: "beta-org", value: "beta-org" },
      { label: "zoe", value: "zoe" },
    ]);
  });

  test("a failing owner source leaves an empty owner list, which the document draws as free text", async () => {
    installRepoPlatform({
      getAccountStatus: async () => {
        throw new Error("offline");
      },
      listRepos: async () => {
        throw new Error("offline");
      },
    });
    loadLocationOptions(() => {});
    await flush();
    expect(locationView("my-site").owners).toEqual([]);
    expect(locationView("my-site").owner).toBe("");
  });

  test("warns when the chosen owner already has a repo of that name", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    loadLocationOptions(() => {});
    await flush();

    // The default owner is "acme", which already owns "site".
    expect(locationView("site").repoTaken).toContain("already exists");
    expect(locationView("brand-new").repoTaken).toBe("");
  });

  test("previews the repository rather than a filesystem path", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    loadLocationOptions(() => {});
    await flush();
    const view = locationView("my-site");
    expect(view.previewLabel).toBe("Repository");
    expect(view.preview).toBe("acme/my-site");
  });

  test("visibility defaults to private, and switching it is carried into the destination", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    loadLocationOptions(() => {});
    await flush();
    expect(locationView("my-site").visibility).toBe("private");

    setLocationVisibility("public");
    expect(locationView("my-site").visibility).toBe("public");
    expect(collectDestination("my-site")).toMatchObject({ private: false });

    setLocationVisibility("private");
    expect(collectDestination("my-site")).toMatchObject({ private: true });
  });

  test("choosing an owner clears the pending error", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    loadLocationOptions(() => {});
    await flush();

    setLocationOwner("zoe");
    expect(collectDestination("my-site")).toMatchObject({ owner: "zoe" });
  });

  test("typing an owner into the free-text field is collected", async () => {
    // No owner sources, so the document draws free text and the write lands the same way.
    installRepoPlatform();
    // Prove the error is cleared by the edit, not merely absent.
    expect(collectDestination("my-site")).toBeNull();
    expect(locationError()).not.toBe("");
    setLocationOwner("hand-typed-org");
    expect(locationError()).toBe("");
    expect(collectDestination("my-site")).toMatchObject({ owner: "hand-typed-org" });
  });
});

// ─── The document's repo branch ───────────────────────────────────────────────

describe("the wizard on a repo platform", () => {
  test("draws an owner picker, a Repository slug, visibility, and the collision hint", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    void openNewProjectModal();
    await flush(4);
    npPress("Confirm");
    await flush(3);

    // The owner field is the kit's select once the owner list has landed.
    expect(npPart("owner")?.localName).toBe("jx-select");
    expect(npPart("location")).toBeNull();
    expect(npPart("visibility")?.localName).toBe("jx-select");
    expect(npPart("slug-row")?.querySelector('[part="label"]')?.textContent).toBe("Repository");

    npType(npSlug(), "site");
    await flush(2);
    // "acme" already owns "site", so the wizard says so rather than letting the create fail.
    expect(npPart("destination-failure")?.textContent).toContain("already exists");
    expect(npPart("destination-preview")?.textContent).toContain("acme/site");

    npType(npSlug(), "brand-new");
    await flush(2);
    expect(npPart("destination-failure")).toBeNull();
  });

  test("the owner and visibility pickers write through to the destination", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    void openNewProjectModal();
    await flush(4);
    npPress("Confirm");
    await flush(3);

    const owner = npPart("owner")!.querySelector('[part="control"]') as HTMLSelectElement;
    owner.value = "zoe";
    owner.dispatchEvent(new Event("change", { bubbles: true }));
    const visibility = npPart("visibility")!.querySelector('[part="control"]') as HTMLSelectElement;
    visibility.value = "public";
    visibility.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);

    npType(npSlug(), "picked");
    await flush(2);
    expect(npPart("destination-preview")?.textContent).toContain("zoe/picked");
    expect(collectDestination("picked")).toEqual({
      kind: "repo",
      owner: "zoe",
      private: false,
      repo: "picked",
    });
  });

  test("a typed Location clears the standing refusal, from the document's own field", async () => {
    installMockPlatform({ createDestination: "path" });
    void openNewProjectModal();
    await flush(4);
    npPress("Confirm");
    await flush(3);
    npType(npName(), "Typed Site");
    await flush();
    npPress("Confirm");
    await flush(2);
    expect(npPart("destination-failure")?.textContent).toContain("Choose a location");

    npType(npPart("location")!.querySelector('[part="input"]') as HTMLInputElement, "/tmp/sites");
    await flush(2);
    expect(npPart("destination-failure")).toBeNull();
  });

  test("with no owner list the owner field is free text", async () => {
    installRepoPlatform();
    void openNewProjectModal();
    await flush(4);
    npPress("Confirm");
    await flush(3);
    expect(npPart("owner")?.localName).toBe("jx-textfield");
  });
});

// ─── Loading gate ─────────────────────────────────────────────────────────────

describe("loadLocationOptions", () => {
  test("is a no-op on path platforms — no owner lookup is attempted", async () => {
    const { state } = installMockPlatform({
      createDestination: "path",
      listRepos: async () => REPOS,
    });
    loadLocationOptions(() => {});
    await flush();
    expect(state.calls.some(([name]) => name === "listRepos")).toBe(false);
  });

  test("resetLocationFields clears a previously chosen destination", async () => {
    installRepoPlatform({ listRepos: async () => REPOS });
    loadLocationOptions(() => {});
    await flush();
    expect(collectDestination("my-site")).not.toBeNull();

    resetLocationFields();
    expect(collectDestination("my-site")).toBeNull();
    expect(locationError()).toBe("Choose an owner for the repository");
  });
});
