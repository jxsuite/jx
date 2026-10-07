/**
 * Repository picker tests — `src/new-project/add-repo-modal.ts` (the flow) and
 * `src/surfaces/add-repo.json` (the dialog it draws into): repo rows with badges, filtering by name
 * and by account, the project-folder step (a scan of the chosen repository, a preselected folder, a
 * typed one, and the refusals each can meet), the keyboard paths through both lists, an import
 * resolving the catalogue root key, the structured not_jx_project failure staying inline,
 * dismissal, and the Open Project mode (write-access filtering, Jx-first ordering, install-App
 * empty state).
 *
 * Everything is addressed by `part`, because the picker is a document: the box, the backdrop,
 * Escape and the Cancel and Open buttons all belong to `jx-dialog`, which is why the dialog lives
 * in `#layer-dialog`.
 */
import { flush, installMockPlatform, mountOverlayLayers } from "./harness";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RepoInfo, RepoProjects } from "../src/types";

const {
  SCAN_DELAY_MS,
  openAddRepoModal,
  openProjectPickerModal,
  platformSupportsAddRepo,
  platformUsesRepoPicker,
} = await import("../src/new-project/add-repo-modal");
const { hydrateAccountStatus, resetAccountStatus } = await import("../src/account-status");
const { initLayers } = await import("../src/ui/layers");

mountOverlayLayers(document.body);
initLayers();

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

const READ_ONLY_REPO: RepoInfo = {
  defaultBranch: "main",
  fullName: "acme/docs",
  isJxProject: true,
  name: "docs",
  owner: "acme",
  permission: "read",
  private: false,
};

const UNTAGGED_WRITABLE_REPO: RepoInfo = {
  defaultBranch: "main",
  fullName: "acme/newsletter",
  isJxProject: false,
  name: "newsletter",
  owner: "acme",
  permission: "write",
  private: false,
};

/** A scan that found the given folders on `main`. */
function found(...locations: RepoProjects["locations"]): RepoProjects {
  return { branch: "main", locations, truncated: false };
}

function d<T extends Element = HTMLElement>(sel: string): T | null {
  return document.querySelector(`#layer-dialog ${sel}`) as T | null;
}

function all<T extends Element = HTMLElement>(sel: string): T[] {
  return [...document.querySelectorAll(`#layer-dialog ${sel}`)] as T[];
}

/** The dialog itself, which is the surface's root. */
function dialog(): HTMLElement | null {
  return d('jx-dialog[part="add-repo"]');
}

function rows(): HTMLElement[] {
  return all('jx-option[part="repo"]');
}

function locationRows(): HTMLElement[] {
  return all('jx-option[part="location"]');
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function dblclick(el: Element): void {
  el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

/** The refusal above the footer. `failure`, not `error`: `jx-textfield` owns that part name. */
function failureText(): string | null {
  return d('[part="failure"]')?.textContent?.trim() ?? null;
}

function emptyText(): string | null {
  return d('[part="empty"]')?.textContent ?? null;
}

function noteText(): string | null {
  return d('[part="note"]')?.textContent ?? null;
}

function summaryText(): string {
  return d('[part="summary"]')?.textContent?.trim() ?? "";
}

function accessLinks(): HTMLAnchorElement[] {
  return all<HTMLAnchorElement>('[part="access-link"]');
}

/** `jx-button` draws the native control, and `disabled` is what that control carries. */
function refreshButton(): HTMLButtonElement | null {
  return d<HTMLButtonElement>('[part="refresh"] [part="control"]');
}

/** The dialog's own primary answer, drawn by `jx-dialog`'s footer. */
function confirmButton(): HTMLButtonElement | null {
  return d<HTMLButtonElement>('jx-dialog[part="add-repo"] [part="confirm"] [part="control"]');
}

function filterInput(): HTMLInputElement {
  return d<HTMLInputElement>('[part="filter"] [part="input"]')!;
}

function folderInput(): HTMLInputElement | null {
  return d<HTMLInputElement>('[part="folder"] [part="input"]');
}

/** Type in the filter, from the control the reader is actually in. */
function filterBy(text: string): void {
  const input = filterInput();
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function typeFolder(text: string): void {
  const input = folderInput()!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(input: HTMLElement, name: string): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name }));
}

/** The listbox's active row, which is the one its `active` id names. */
function activeRow(list: "repo-list" | "location-list"): HTMLElement | null {
  const box = d<HTMLElement & { active?: string }>(`[part="${list}"]`);
  const id = box?.active ?? "";
  return id ? d(`#${id}`) : null;
}

/** Press Open, the way a reader would. */
function pressOpen(): void {
  click(confirmButton()!);
}

/**
 * Dismiss it the way a reader would: the platform's `cancel`, which is what Escape raises on a
 * native `<dialog>` and what the kit's own Cancel button dispatches.
 */
function dismiss(): void {
  dialog()?.dispatchEvent(new Event("cancel", { bubbles: true }));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

afterEach(() => {
  dismiss();
  resetAccountStatus();
});

describe("platformSupportsAddRepo", () => {
  test("requires both listRepos and importProject", () => {
    installMockPlatform();
    expect(platformSupportsAddRepo()).toBe(false);
    installMockPlatform({ listRepos: () => Promise.resolve(REPOS) });
    expect(platformSupportsAddRepo()).toBe(false);
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "octocat/site@main" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    expect(platformSupportsAddRepo()).toBe(true);
  });
});

describe("platformUsesRepoPicker", () => {
  test("requires the repo-list marker on top of listRepos + importProject", () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "octocat/site@main" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    expect(platformUsesRepoPicker()).toBe(false);
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "octocat/site@main" }),
      listRepos: () => Promise.resolve(REPOS),
      openProjectPicker: "repo-list",
    });
    expect(platformUsesRepoPicker()).toBe(true);
    // The marker alone is not enough without the backing capabilities.
    installMockPlatform({ openProjectPicker: "repo-list" });
    expect(platformUsesRepoPicker()).toBe(false);
  });
});

describe("openAddRepoModal", () => {
  test("lists repos with badges and filters by full name", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "octocat/site@main" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    expect(dialog()).toBeTruthy();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain("octocat/site");
    expect(rows()[0]!.textContent).toContain("Jx");
    expect(rows()[0]!.textContent).toContain("private");
    // A row says its branch; the permission is the chosen repository's detail, not every row's.
    expect(rows()[1]!.querySelector('[part="description"]')?.textContent).toBe("trunk");
    expect(rows()[1]!.textContent).not.toContain("private");

    filterBy("acme");
    await flush();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain("acme/marketing");

    dismiss();
    expect(await promise).toBeNull();
  });

  test("the dialog is the kit's, headline, answers and all — nothing here draws a box", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    expect(dialog()?.querySelector('[part="headline"]')?.textContent).toBe(
      "Add existing repository",
    );
    expect(confirmButton()?.textContent?.trim()).toBe("Add");
    // Nothing is chosen yet, so there is nothing to add.
    expect(confirmButton()?.disabled).toBe(true);
    expect(d("sp-dialog-wrapper")).toBeNull();
    expect(d("sp-underlay")).toBeNull();
    dismiss();
    expect(await promise).toBeNull();
    expect(dialog()).toBeNull();
  });

  test("the filter field has the focus once the dialog is up", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(4);
    expect(document.activeElement).toBe(filterInput());
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a repository whose project is its root opens at the root", async () => {
    const importProject = mock((opts: { owner: string; name: string; dir?: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@main` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: () => Promise.resolve(found({ dir: "", name: "Site" })),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    expect(d('[part="detail"]')?.textContent).toContain("Choose a repository");
    click(rows()[0]!);
    await flush(3);
    expect(activeRow("repo-list")).toBe(rows()[0]!);
    expect(d('[part="detail-name"]')?.textContent).toBe("octocat/site");
    expect(d('[part="detail-meta"]')?.textContent).toBe("main · admin · private");
    expect(locationRows()).toHaveLength(1);
    expect(locationRows()[0]!.textContent).toContain("Site");
    expect(locationRows()[0]!.textContent).toContain("/");
    expect(activeRow("location-list")).toBe(locationRows()[0]!);
    expect(folderInput()?.value).toBe("");
    expect(summaryText()).toBe("Adds octocat/site at the repository root on main.");
    expect(confirmButton()?.disabled).toBe(false);

    pressOpen();
    await flush();
    expect(importProject).toHaveBeenCalledWith({ name: "site", owner: "octocat" });
    expect(await promise).toEqual({ root: "octocat/site@main" });
    await flush();
    expect(dialog()).toBeNull();
  });

  test("a project in a subfolder is preselected and opened as itself", async () => {
    const importProject = mock((opts: { owner: string; name: string; dir?: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@main:${opts.dir}` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: () => Promise.resolve(found({ dir: "Sites/avunu.net", name: "Avunu" })),
      listRepos: () => Promise.resolve(REPOS),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    click(rows()[0]!);
    await flush(3);
    expect(locationRows()[0]!.textContent).toContain("Avunu");
    expect(locationRows()[0]!.textContent).toContain("Sites/avunu.net/");
    expect(folderInput()?.value).toBe("Sites/avunu.net");
    // The field is named by the label a reader sees above it, not by a second hidden string.
    const named = folderInput()?.getAttribute("aria-labelledby") ?? "";
    expect(named).not.toBe("");
    expect(document.querySelector(`#${named}`)?.textContent).toBe("Project Folder");
    expect(summaryText()).toBe("Opens octocat/site at Sites/avunu.net/ on main.");
    expect(confirmButton()?.textContent?.trim()).toBe("Open");

    pressOpen();
    await flush();
    expect(importProject).toHaveBeenCalledWith({
      dir: "Sites/avunu.net",
      name: "site",
      owner: "octocat",
    });
    expect(await promise).toEqual({ root: "octocat/site@main:Sites/avunu.net" });
  });

  test("with several projects the root is preselected and any other can be picked", async () => {
    const importProject = mock((opts: { owner: string; name: string; dir?: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@main:${opts.dir ?? ""}` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: () =>
        Promise.resolve(
          found({ dir: "" }, { dir: "sites/blog", name: "Blog" }, { dir: "sites/shop" }),
        ),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush(3);
    expect(locationRows().map((row) => row.dataset["dir"])).toEqual([
      "",
      "sites/blog",
      "sites/shop",
    ]);
    // A root with no name of its own is called by its repository; a folder by its last segment.
    expect(locationRows()[0]!.textContent).toContain("site");
    expect(locationRows()[2]!.textContent).toContain("shop");
    expect(activeRow("location-list")).toBe(locationRows()[0]!);

    click(locationRows()[1]!);
    await flush();
    expect(folderInput()?.value).toBe("sites/blog");
    expect(activeRow("location-list")).toBe(locationRows()[1]!);

    // The folder field drives the list from the keys: down, and round from the last to the first.
    key(folderInput()!, "ArrowDown");
    await flush();
    expect(folderInput()?.value).toBe("sites/shop");
    key(folderInput()!, "ArrowDown");
    await flush();
    expect(folderInput()?.value).toBe("");
    key(folderInput()!, "ArrowUp");
    await flush();
    expect(folderInput()?.value).toBe("sites/shop");

    key(folderInput()!, "Enter");
    await flush();
    expect(importProject).toHaveBeenCalledWith({
      dir: "sites/shop",
      name: "site",
      owner: "octocat",
    });
    expect(await promise).toEqual({ root: "octocat/site@main:sites/shop" });
  });

  test("a typed folder is opened in its canonical spelling, and one that climbs is refused", async () => {
    const importProject = mock((opts: { owner: string; name: string; dir?: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@main:${opts.dir ?? ""}` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: () => Promise.resolve(found({ dir: "" })),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush(3);

    typeFolder("../elsewhere");
    await flush();
    expect(d('[part="folder-row"]')?.textContent).toContain("without . or .. segments");
    expect(confirmButton()?.disabled).toBe(true);
    expect(summaryText()).toBe("");
    // Refused means refused: Enter in the field does nothing either.
    key(folderInput()!, "Enter");
    await flush();
    expect(importProject).not.toHaveBeenCalled();

    typeFolder("/apps/site/");
    await flush();
    expect(confirmButton()?.disabled).toBe(false);
    expect(summaryText()).toBe("Adds octocat/site at apps/site/ on main.");
    // A typed folder the scan did not list highlights no row.
    expect(activeRow("location-list")).toBeNull();

    typeFolder("/");
    await flush();
    // The root, typed: the root's row again.
    expect(activeRow("location-list")).toBe(locationRows()[0]!);

    typeFolder("/apps/site/");
    await flush();
    pressOpen();
    await flush();
    expect(importProject).toHaveBeenCalledWith({
      dir: "apps/site",
      name: "site",
      owner: "octocat",
    });
    expect(await promise).toEqual({ root: "octocat/site@main:apps/site" });
  });

  test("a repository with no project.json offers nothing until a folder is named", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepoProjects: () => Promise.resolve(found()),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[1]!);
    await flush(3);
    expect(noteText()).toContain("No folder in this repository holds a project.json");
    expect(confirmButton()?.disabled).toBe(true);
    typeFolder("site");
    await flush();
    expect(confirmButton()?.disabled).toBe(false);
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a repository too large to scan says so under the folder field", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepoProjects: () =>
        Promise.resolve({ branch: "main", locations: [{ dir: "web" }], truncated: true }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush(3);
    expect(d('[part="folder-row"]')?.textContent).toContain("too large to scan in full");
    expect(folderInput()?.value).toBe("web");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a scan that fails leaves the folder field to name one, and the root to open", async () => {
    const importProject = mock(() => Promise.resolve({ root: "octocat/site@main" }));
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: () => Promise.reject(new Error("GitHub said no")),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush(3);
    expect(noteText()).toContain("couldn't list this repository's projects");
    expect(locationRows()).toHaveLength(0);
    expect(confirmButton()?.disabled).toBe(false);
    pressOpen();
    await flush();
    expect(importProject).toHaveBeenCalledWith({ name: "site", owner: "octocat" });
    expect(await promise).toEqual({ root: "octocat/site@main" });
  });

  test("a platform that cannot scan opens the root, or the folder the reader names", async () => {
    const importProject = mock((opts: { owner: string; name: string; dir?: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@main:${opts.dir ?? ""}` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush();
    expect(noteText()).toContain("Name the folder that holds the project's project.json");
    expect(confirmButton()?.disabled).toBe(false);
    typeFolder("docs");
    await flush();
    pressOpen();
    await flush();
    expect(importProject).toHaveBeenCalledWith({ dir: "docs", name: "site", owner: "octocat" });
    expect(await promise).toEqual({ root: "octocat/site@main:docs" });
  });

  test("the filter's arrows choose repositories and Enter opens the chosen one", async () => {
    const scans: string[] = [];
    const importProject = mock((opts: { owner: string; name: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@trunk` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: (repo) => {
        scans.push(`${repo.owner}/${repo.name}`);
        return Promise.resolve(found({ dir: "" }));
      },
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    // With nothing chosen, Enter chooses the first visible repository rather than opening anything.
    key(filterInput(), "Enter");
    await flush(3);
    expect(activeRow("repo-list")).toBe(rows()[0]!);
    expect(importProject).not.toHaveBeenCalled();

    key(filterInput(), "ArrowDown");
    await flush();
    expect(activeRow("repo-list")).toBe(rows()[1]!);
    // The caret's scan waits, in case it is only passing through.
    expect(scans).toEqual(["octocat/site"]);
    expect(noteText()).toContain("Looking for project.json files");
    expect(confirmButton()?.disabled).toBe(true);
    await wait(SCAN_DELAY_MS + 20);
    await flush();
    expect(scans).toEqual(["octocat/site", "acme/marketing"]);

    // Down at the bottom stays at the bottom.
    key(filterInput(), "ArrowDown");
    await flush();
    expect(activeRow("repo-list")).toBe(rows()[1]!);

    key(filterInput(), "Enter");
    await flush();
    expect(importProject).toHaveBeenCalledWith({ name: "marketing", owner: "acme" });
    expect(await promise).toEqual({ root: "acme/marketing@trunk" });
  });

  test("the caret passing through repositories scans only where it stops", async () => {
    const scans: string[] = [];
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepoProjects: (repo) => {
        scans.push(repo.name);
        return Promise.resolve(found({ dir: "" }));
      },
      listRepos: () => Promise.resolve([...REPOS, UNTAGGED_WRITABLE_REPO]),
    });
    const promise = openAddRepoModal();
    await flush(3);
    key(filterInput(), "ArrowDown");
    key(filterInput(), "ArrowDown");
    key(filterInput(), "ArrowDown");
    await wait(SCAN_DELAY_MS + 20);
    await flush();
    expect(scans).toEqual(["newsletter"]);

    // Coming back to one it skipped asks for it, rather than waiting forever on a scan never made.
    key(filterInput(), "ArrowUp");
    await wait(SCAN_DELAY_MS + 20);
    await flush();
    expect(scans).toEqual(["newsletter", "marketing"]);
    expect(locationRows()).toHaveLength(1);

    // And a repository already scanned is not asked twice.
    key(filterInput(), "ArrowDown");
    await wait(SCAN_DELAY_MS + 20);
    await flush();
    expect(scans).toEqual(["newsletter", "marketing"]);
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a double-click opens a repository holding one project in one gesture", async () => {
    let land: (projects: RepoProjects) => void = () => {};
    const importProject = mock((opts: { owner: string; name: string; dir?: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@main:${opts.dir}` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: () =>
        new Promise<RepoProjects>((resolve) => {
          land = resolve;
        }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    dblclick(rows()[0]!);
    await flush();
    // The scan has not landed, so the double-click waits for it rather than opening the root.
    expect(importProject).not.toHaveBeenCalled();
    land(found({ dir: "web" }));
    await flush(3);
    expect(importProject).toHaveBeenCalledWith({ dir: "web", name: "site", owner: "octocat" });
    expect(await promise).toEqual({ root: "octocat/site@main:web" });
  });

  test("a double-click on a repository holding several projects only chooses it", async () => {
    const importProject = mock(() => Promise.resolve({ root: "r" }));
    installMockPlatform({
      importProject: importProject as never,
      listRepoProjects: () => Promise.resolve(found({ dir: "a" }, { dir: "b" })),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush(3);
    dblclick(rows()[0]!);
    await flush(3);
    expect(importProject).not.toHaveBeenCalled();
    expect(locationRows()).toHaveLength(2);
    // A double-click on a folder row is that folder, opened.
    click(locationRows()[1]!);
    dblclick(locationRows()[1]!);
    await flush();
    expect(importProject).toHaveBeenCalledWith({ dir: "b", name: "site", owner: "octocat" });
    expect(await promise).toEqual({ root: "r" });
  });

  test("the account filter narrows the list, and is absent when there is one account", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    const owner = d<HTMLSelectElement>('[part="owner"] select');
    expect(owner).toBeTruthy();
    expect([...owner!.options].map((option) => option.textContent)).toEqual([
      "All accounts",
      "acme",
      "octocat",
    ]);
    owner!.value = "octocat";
    owner!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(rows().map((row) => row.title)).toEqual(["octocat/site"]);
    filterBy("marketing");
    await flush();
    expect(emptyText()).toContain("No repositories match the filter.");
    dismiss();
    expect(await promise).toBeNull();

    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve([REPOS[0]!]),
    });
    const single = openAddRepoModal();
    await flush(3);
    expect(d('[part="owner"]')).toBeNull();
    dismiss();
    expect(await single).toBeNull();
  });

  test("while an import runs the answer says so and cannot be given twice", async () => {
    let finish: (value: { root: string }) => void = () => {};
    const importProject = mock(
      () =>
        new Promise<{ root: string }>((resolve) => {
          finish = resolve;
        }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepos: () => Promise.resolve(REPOS),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    click(rows()[0]!);
    await flush();
    pressOpen();
    await flush();
    expect(confirmButton()?.textContent?.trim()).toBe("Opening…");
    expect(confirmButton()?.disabled).toBe(true);
    expect(refreshButton()).toBeNull();
    dialog()!.dispatchEvent(new Event("confirm"));
    // A second repository cannot be chosen mid-adoption either.
    click(rows()[1]!);
    await flush();
    expect(importProject).toHaveBeenCalledTimes(1);
    expect(d('[part="detail-name"]')?.textContent).toBe("octocat/site");
    finish({ root: "octocat/site@main" });
    expect(await promise).toEqual({ root: "octocat/site@main" });
  });

  test("a not_jx_project failure stays inline and the picker remains open", async () => {
    installMockPlatform({
      importProject: () =>
        Promise.reject(
          Object.assign(new Error("acme/marketing has no readable project.json"), {
            code: "not_jx_project",
          }),
        ),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[1]!);
    await flush();
    pressOpen();
    await flush();
    expect(dialog()).toBeTruthy();
    expect(failureText()).toContain("no readable project.json");
    // The list survives the refusal: the other repositories are still on offer.
    expect(rows()).toHaveLength(2);
    expect(confirmButton()?.disabled).toBe(false);
    // Naming another folder is a new attempt, so the old refusal goes.
    typeFolder("site");
    await flush();
    expect(failureText()).toBeNull();

    dismiss();
    expect(await promise).toBeNull();
  });

  const JOIN = { href: "https://example.test/join", id: "join", label: "Join" };

  /* Adopting a repository is something a backend may refuse until the user acts (desktop.md §10.4):
     the refusal's actions are offered, and an action that is done imports again. */
  test("an action-required refusal is offered, and the import runs again once it is done", async () => {
    let attempts = 0;
    installMockPlatform({
      importProject: (async (opts: { owner: string; name: string }) => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("Opening octocat/site needs a team membership."), {
            actions: [JOIN],
            code: "action_required",
          });
        }
        return { root: `${opts.owner}/${opts.name}@main` };
      }) as never,
      listRepos: () => Promise.resolve(REPOS),
      performAction: async () => ({ status: "done" }),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush();
    pressOpen();
    await flush(3);
    expect(failureText()).toContain("needs a team membership");
    const offer = [...document.querySelectorAll("jx-dialog")].find(
      (element) => element.getAttribute("part") !== "add-repo",
    ) as HTMLElement;
    offer.dispatchEvent(new Event("confirm"));
    expect(await promise).toEqual({ root: "octocat/site@main" });
    expect(attempts).toBe(2);
  });

  test("a declined offer leaves the refusal inline and imports nothing more", async () => {
    let attempts = 0;
    installMockPlatform({
      importProject: (async () => {
        attempts += 1;
        throw Object.assign(new Error("Opening octocat/site needs a team membership."), {
          actions: [JOIN],
          code: "action_required",
        });
      }) as never,
      listRepos: () => Promise.resolve(REPOS),
      performAction: async () => ({ status: "canceled" }),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush();
    pressOpen();
    await flush(3);
    const offer = [...document.querySelectorAll("jx-dialog")].find(
      (element) => element.getAttribute("part") !== "add-repo",
    ) as HTMLElement;
    offer.dispatchEvent(new Event("cancel"));
    await flush(3);
    expect(attempts).toBe(1);
    expect(failureText()).toContain("needs a team membership");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a failed repo listing shows the error with an empty list", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.reject(new Error("GitHub authorization expired")),
    });
    const promise = openAddRepoModal();
    await flush(3);
    expect(rows()).toHaveLength(0);
    expect(failureText()).toContain("GitHub authorization expired");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("add mode shows read-only repos (no write filter)", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve([READ_ONLY_REPO]),
    });
    const promise = openAddRepoModal();
    await flush(3);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain("acme/docs");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a filter that matches nothing says so, and says which absence it is", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    filterBy("nothing-like-this");
    await flush();
    expect(rows()).toHaveLength(0);
    expect(emptyText()).toContain("No repositories match the filter.");
    // Arrows and Enter over an empty list do nothing at all.
    key(filterInput(), "ArrowDown");
    key(filterInput(), "Enter");
    await flush();
    expect(d('[part="detail-name"]')).toBeNull();
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a scan that lands after dismissal does not resurrect the dialog", async () => {
    let land: (projects: RepoProjects) => void = () => {};
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepoProjects: () =>
        new Promise<RepoProjects>((resolve) => {
          land = resolve;
        }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush();
    dismiss();
    expect(await promise).toBeNull();
    land(found({ dir: "" }));
    await flush(2);
    expect(dialog()).toBeNull();
  });
});

describe("repository-access footer", () => {
  const MANAGE_URL = "https://github.com/settings/installations/7";
  const INSTALL_URL = "https://github.com/apps/jx-suite/installations/new";

  test("offers a manage link per installation plus another-account install", async () => {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: INSTALL_URL,
          installations: [{ account: "octocat", id: 7, manageUrl: MANAGE_URL }],
        }),
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    // Rendered alongside a populated list — widening access is not just an empty-state fallback.
    expect(rows()).toHaveLength(2);
    expect(accessLinks().map((a) => [a.textContent?.trim(), a.href])).toEqual([
      ["octocat", MANAGE_URL],
      ["Another account…", INSTALL_URL],
    ]);
    dismiss();
    expect(await promise).toBeNull();
  });

  test("the picker hydrates account status itself, so Add mode gets the links too", async () => {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: INSTALL_URL,
          installations: [{ account: "octocat", id: 7, manageUrl: MANAGE_URL }],
        }),
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    // No hydrateAccountStatus() call here — opening the dialog must be enough.
    const promise = openAddRepoModal();
    await flush(3);
    expect(accessLinks()).toHaveLength(2);
    dismiss();
    expect(await promise).toBeNull();
  });

  test("Refresh re-reads repositories granted while the dialog stayed open", async () => {
    let granted = false;
    let release: (() => void) | null = null;
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: INSTALL_URL,
          installations: [{ account: "octocat", id: 7, manageUrl: MANAGE_URL }],
        }),
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () =>
        granted
          ? new Promise<RepoInfo[]>((resolve) => {
              release = () => resolve(REPOS);
            })
          : Promise.resolve([REPOS[0]!]),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    expect(rows()).toHaveLength(1);

    granted = true;
    click(refreshButton()!);
    await flush();
    // Mid-refresh the list is unknown again, so Refresh cannot be double-fired.
    expect(refreshButton()!.disabled).toBe(true);
    expect(emptyText()).toContain("Loading repositories…");

    release!();
    await flush(2);
    expect(rows()).toHaveLength(2);
    expect(refreshButton()!.disabled).toBe(false);

    dismiss();
    expect(await promise).toBeNull();
  });

  test("Refresh scans the chosen repository again, since a project.json may have just landed", async () => {
    let scans = 0;
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: INSTALL_URL,
          installations: [{ account: "octocat", id: 7, manageUrl: MANAGE_URL }],
        }),
      importProject: () => Promise.resolve({ root: "r" }),
      listRepoProjects: () => {
        scans += 1;
        return Promise.resolve(scans === 1 ? found() : found({ dir: "web" }));
      },
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    click(rows()[0]!);
    await flush(3);
    expect(locationRows()).toHaveLength(0);
    click(refreshButton()!);
    await flush(4);
    expect(scans).toBe(2);
    expect(locationRows()).toHaveLength(1);
    expect(folderInput()?.value).toBe("web");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("platforms with no account status show no access footer", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
    });
    const promise = openAddRepoModal();
    await flush(3);
    expect(accessLinks()).toHaveLength(0);
    expect(refreshButton()).toBeNull();
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a listing that settles after dismissal does not resurrect the dialog", async () => {
    let release: (repos: RepoInfo[]) => void = () => {};
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () =>
        new Promise<RepoInfo[]>((resolve) => {
          release = resolve;
        }),
    });
    const promise = openAddRepoModal();
    await flush(3);
    dismiss();
    expect(dialog()).toBeNull();
    release(REPOS);
    await flush(2);
    expect(dialog()).toBeNull();
    expect(await promise).toBeNull();
  });
});

describe("openProjectPickerModal", () => {
  test("shows only writable repos, Jx-tagged first, under the Open Project title", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "octocat/site@main" }),
      listRepos: () => Promise.resolve([UNTAGGED_WRITABLE_REPO, READ_ONLY_REPO, ...REPOS]),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    expect(dialog()?.querySelector('[part="headline"]')?.textContent).toBe("Open Project");
    const names = rows().map((row) => row.title);
    // Read-only acme/docs is absent; Jx-tagged octocat/site precedes the untagged writable repos.
    expect(names).toEqual(["octocat/site", "acme/newsletter", "acme/marketing"]);
    dismiss();
    expect(await promise).toBeNull();
  });

  test("choosing and opening imports the repo and resolves its catalogue root key", async () => {
    const importProject = mock((opts: { owner: string; name: string }) =>
      Promise.resolve({ root: `${opts.owner}/${opts.name}@main` }),
    );
    installMockPlatform({
      importProject: importProject as never,
      listRepos: () => Promise.resolve(REPOS),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    click(rows()[0]!);
    await flush();
    pressOpen();
    await flush();
    expect(importProject).toHaveBeenCalledWith({ name: "site", owner: "octocat" });
    expect(await promise).toEqual({ root: "octocat/site@main" });
  });

  test("an untagged repo's import failure stays inline", async () => {
    installMockPlatform({
      importProject: () =>
        Promise.reject(
          Object.assign(new Error("acme/newsletter has no readable project.json"), {
            code: "not_jx_project",
          }),
        ),
      listRepos: () => Promise.resolve([UNTAGGED_WRITABLE_REPO]),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    click(rows()[0]!);
    await flush();
    pressOpen();
    await flush();
    expect(dialog()).toBeTruthy();
    expect(failureText()).toContain("no readable project.json");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("repos without write access get the widen-access empty state", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve([READ_ONLY_REPO]),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    expect(rows()).toHaveLength(0);
    expect(emptyText()).toContain("Repositories you can write to are listed here.");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("no reachable repos prompts a GitHub App install link", async () => {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: "https://github.com/apps/jx-suite/installations/new",
          installations: [],
        }),
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve([]),
      openProjectPicker: "repo-list",
    });
    await hydrateAccountStatus();
    const promise = openProjectPickerModal();
    await flush(3);
    const link = d<HTMLAnchorElement>('[part="install"]')!;
    expect(link).toBeTruthy();
    expect(link.href).toBe("https://github.com/apps/jx-suite/installations/new");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("an installed App that reaches nothing says that instead", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve([]),
      openProjectPicker: "repo-list",
    });
    const promise = openProjectPickerModal();
    await flush(3);
    expect(d('[part="install"]')).toBeNull();
    expect(emptyText()).toContain("Install the App, or widen its repository access");
    dismiss();
    expect(await promise).toBeNull();
  });

  test("a second open while one is up resolves null and leaves the first alone", async () => {
    installMockPlatform({
      importProject: () => Promise.resolve({ root: "r" }),
      listRepos: () => Promise.resolve(REPOS),
      openProjectPicker: "repo-list",
    });
    const first = openProjectPickerModal();
    await flush(3);
    expect(await openAddRepoModal()).toBeNull();
    expect(all('jx-dialog[part="add-repo"]')).toHaveLength(1);
    dismiss();
    expect(await first).toBeNull();
  });
});
