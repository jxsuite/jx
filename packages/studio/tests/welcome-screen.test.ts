/**
 * Start-pane tests (E9). Renders the no-project pane into a detached host with a mock platform and
 * seeded recents, then asserts the Start commands, the disambiguated recents (name + distinguishing
 * folder + last opened), the per-row remove and Clear all, the GitHub-App prompt, and the
 * catalogue.
 */
import { flush, installMockPlatform, pointer } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const {
  disposeWelcome,
  initWelcome,
  lastOpenedLabel,
  recentLocations,
  renderWelcome,
  shortenPath,
} = await import("../src/surfaces/welcome");
const { hydrateProjectList, resetProjectList } = await import("../src/project-list");
const { hydrateAccountStatus, resetAccountStatus } = await import("../src/account-status");

const RECENT_KEY = "jx-studio-recent-projects";

interface Ctx {
  openProject: ReturnType<typeof mock>;
  openRecentProject: ReturnType<typeof mock>;
  openNewProject: ReturnType<typeof mock>;
  cloneRepository: ReturnType<typeof mock>;
  addExistingRepo: ReturnType<typeof mock>;
}

function makeCtx(): Ctx {
  return {
    addExistingRepo: mock(() => {}),
    cloneRepository: mock(() => {}),
    openNewProject: mock(() => {}),
    openProject: mock(() => {}),
    openRecentProject: mock((_root: string) => {}),
  };
}

/** Draw the pane into a fresh host and let the surface mount, reconcile and connect. */
async function renderScreen(ctx: Ctx): Promise<HTMLElement> {
  initWelcome(ctx as never);
  const host = document.createElement("div");
  document.body.append(host);
  renderWelcome(host);
  await flush();
  await flush();
  return host;
}

/** Bring a drawn pane up to date with the stores, and let the rows reconcile. */
async function redraw(host: HTMLElement): Promise<void> {
  renderWelcome(host);
  await flush();
  await flush();
}

function actions(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll('[part="action"]')] as HTMLElement[];
}

function texts(host: HTMLElement, selector: string): (string | null)[] {
  return [...host.querySelectorAll(selector)].map((n) => n.textContent?.trim() ?? null);
}

function seedRecents(entries: { name: string; root: string; timestamp: number }[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries));
}

beforeEach(() => {
  localStorage.removeItem(RECENT_KEY);
  resetProjectList();
  resetAccountStatus();
  installMockPlatform();
});

afterEach(async () => {
  disposeWelcome();
  document.body.replaceChildren();
  await flush();
});

describe("renderWelcome — start commands", () => {
  test("renders the title, the corrected tagline, and the two always-available commands", async () => {
    const host = await renderScreen(makeCtx());
    expect(host.querySelector('[part="title"]')?.textContent).toBe("Jx Studio");
    expect(host.querySelector('[part="subtitle"]')?.textContent).toBe(
      "Design, build, and publish websites",
    );

    const btns = actions(host);
    expect(btns).toHaveLength(2);
    expect(btns[0]!.textContent).toContain("New Project…");
    expect(btns[1]!.textContent).toContain("Open Project…");
    // Starters are the first step of New Project now, not a second button beside it.
    expect(host.textContent).not.toContain("Start from an Example");
    // Mock platform has no gitClone, so the clone action is hidden.
    expect(host.textContent).not.toContain("Clone Git Repository");
  });

  test("New Project and Open Project invoke the ctx callbacks", async () => {
    const ctx = makeCtx();
    const host = await renderScreen(ctx);
    const [newBtn, openBtn] = actions(host);
    pointer(newBtn!, "click");
    expect(ctx.openNewProject).toHaveBeenCalledTimes(1);
    expect(ctx.openNewProject).toHaveBeenLastCalledWith();
    pointer(openBtn!, "click");
    expect(ctx.openProject).toHaveBeenCalledTimes(1);
    expect(ctx.cloneRepository).not.toHaveBeenCalled();
  });

  test("shows Add Existing Repository when the platform can browse + import repos", async () => {
    installMockPlatform({
      importProject: (() => Promise.resolve({ root: "octocat/site@main" })) as never,
      listRepos: (() => Promise.resolve([])) as never,
    });
    const ctx = makeCtx();
    const host = await renderScreen(ctx);
    const btns = actions(host);
    expect(btns).toHaveLength(3);
    expect(btns[2]!.textContent).toContain("Add Existing Repository…");
    pointer(btns[2]!, "click");
    expect(ctx.addExistingRepo).toHaveBeenCalledTimes(1);
  });

  test("shows the clone action when the platform supports gitClone", async () => {
    installMockPlatform({
      gitClone: (async () => ({ ok: true, root: "/cloned" })) as never,
    });
    const ctx = makeCtx();
    const host = await renderScreen(ctx);
    const btns = actions(host);
    expect(btns).toHaveLength(3);
    expect(btns[2]!.textContent).toContain("Clone Git Repository…");
    pointer(btns[2]!, "click");
    expect(ctx.cloneRepository).toHaveBeenCalledTimes(1);
  });
});

describe("shortenPath", () => {
  test("rewrites a home path and leaves everything else alone", () => {
    expect(shortenPath("/home/dev/Sites/alpha")).toBe("~/Sites/alpha");
    expect(shortenPath("/Users/dev/Sites/alpha")).toBe("~/Sites/alpha");
    expect(shortenPath("/home/dev")).toBe("~");
    expect(shortenPath("/srv/sites/beta")).toBe("/srv/sites/beta");
    expect(shortenPath("acme/shop")).toBe("acme/shop");
  });
});

describe("recentLocations", () => {
  test("uses the immediate parent folder when names are unique", () => {
    const labels = recentLocations([
      { name: "Alpha", root: "/home/dev/Sites/alpha" },
      { name: "Beta", root: "/srv/www/beta" },
    ]);
    expect(labels.get("/home/dev/Sites/alpha")).toBe("…/Sites");
    expect(labels.get("/srv/www/beta")).toBe("…/www");
  });

  test("deepens the path until two same-named projects are distinguishable", () => {
    const labels = recentLocations([
      { name: "My Site", root: "/home/dev/clients/acme/site" },
      { name: "My Site", root: "/home/dev/personal/acme/site" },
    ]);
    expect(labels.get("/home/dev/clients/acme/site")).toBe("…/clients/acme");
    expect(labels.get("/home/dev/personal/acme/site")).toBe("…/personal/acme");
  });

  test("falls back to the whole shortened root when the ancestors are identical", () => {
    const labels = recentLocations([
      { name: "My Site", root: "/home/dev/Sites/one" },
      { name: "My Site", root: "/home/dev/Sites/two" },
    ]);
    expect(labels.get("/home/dev/Sites/one")).toBe("~/Sites/one");
    expect(labels.get("/home/dev/Sites/two")).toBe("~/Sites/two");
  });

  test("keeps the leading marker when the label reaches the top of the path", () => {
    const labels = recentLocations([
      { name: "One", root: "/srv/one" },
      { name: "Two", root: "/home/dev/two" },
      { name: "Three", root: "acme/three" },
      { name: "Root", root: "/root-project" },
    ]);
    expect(labels.get("/srv/one")).toBe("/srv");
    expect(labels.get("/home/dev/two")).toBe("~");
    expect(labels.get("acme/three")).toBe("acme");
    // No ancestors at all — the root is its own label.
    expect(labels.get("/root-project")).toBe("/root-project");
  });
});

describe("lastOpenedLabel", () => {
  const NOW = 1_700_000_000_000;
  const cases: [number, string][] = [
    [0, "just now"],
    [30_000, "just now"],
    [60_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [3_600_000, "1 hour ago"],
    [5 * 3_600_000, "5 hours ago"],
    [86_400_000, "yesterday"],
    [4 * 86_400_000, "4 days ago"],
    [40 * 86_400_000, "1 month ago"],
    [100 * 86_400_000, "3 months ago"],
    [800 * 86_400_000, "over a year ago"],
  ];
  for (const [elapsed, expected] of cases) {
    test(`${elapsed}ms ago reads "${expected}"`, () => {
      expect(lastOpenedLabel(NOW - elapsed, NOW)).toBe(expected);
    });
  }

  test("a future timestamp reads as just now rather than a negative age", () => {
    expect(lastOpenedLabel(NOW + 60_000, NOW)).toBe("just now");
  });

  test("defaults to the current clock", () => {
    expect(lastOpenedLabel(Date.now())).toBe("just now");
  });
});

describe("renderWelcome — recent projects", () => {
  test("omits the Recent section when there are no recent projects", async () => {
    const host = await renderScreen(makeCtx());
    expect(host.textContent).not.toContain("Recent");
    expect(host.querySelectorAll('[part="recent"]')).toHaveLength(0);
  });

  test("lists recents newest-first as name + folder + last opened, never a raw path", async () => {
    const now = Date.now();
    seedRecents([
      { name: "Beta", root: "/srv/sites/beta", timestamp: now - 2 * 86_400_000 },
      { name: "Alpha", root: "/home/user/dev/alpha", timestamp: now - 3_600_000 },
    ]);
    const host = await renderScreen(makeCtx());

    const rows = [
      ...host.querySelectorAll('[part="recent"]:not([data-catalogue])'),
    ] as HTMLButtonElement[];
    expect(rows).toHaveLength(2);
    expect(texts(host, '[part="recent"] [part="name"]')).toEqual(["Alpha", "Beta"]);
    expect(texts(host, '[part="recent"] [part="path"]')).toEqual(["…/dev", "…/sites"]);
    expect(texts(host, '[part="recent"] [part="when"]')).toEqual(["1 hour ago", "2 days ago"]);
    // The full root stays reachable as a tooltip, not as the row's headline.
    expect(rows[0]!.getAttribute("title")).toBe("/home/user/dev/alpha");
  });

  test("same-named projects get enough path to tell them apart", async () => {
    seedRecents([
      { name: "My Site", root: "/home/user/clients/acme/site", timestamp: 2 },
      { name: "My Site", root: "/home/user/personal/acme/site", timestamp: 1 },
    ]);
    const host = await renderScreen(makeCtx());
    expect(texts(host, '[part="recent"] [part="path"]')).toEqual([
      "…/clients/acme",
      "…/personal/acme",
    ]);
  });

  test("clicking a recent project opens it by root", async () => {
    seedRecents([{ name: "Alpha", root: "/home/user/dev/alpha", timestamp: 5 }]);
    const ctx = makeCtx();
    const host = await renderScreen(ctx);
    pointer(host.querySelector('[part="recent"]:not([data-catalogue])')!, "click");
    expect(ctx.openRecentProject).toHaveBeenCalledWith("/home/user/dev/alpha");
  });

  test("each recent project has a remove control that drops just that entry", async () => {
    seedRecents([
      { name: "Alpha", root: "/a", timestamp: 2 },
      { name: "Beta", root: "/b", timestamp: 1 },
    ]);
    const ctx = makeCtx();
    const host = await renderScreen(ctx);
    const removes = [...host.querySelectorAll('[part="remove"]')] as HTMLElement[];
    expect(removes).toHaveLength(2);
    expect(removes[0]!.querySelector('[part="control"]')?.getAttribute("aria-label")).toBe(
      "Remove Alpha from Recent",
    );
    pointer(removes[0]!, "click"); // Alpha is newest-first
    await flush();
    expect(ctx.openRecentProject).not.toHaveBeenCalled();
    await redraw(host); // Reflect the mutation
    expect(texts(host, '[part="recent"] [part="name"]')).toEqual(["Beta"]);
  });

  test("Clear all empties the recent list", async () => {
    seedRecents([{ name: "Alpha", root: "/a", timestamp: 1 }]);
    const host = await renderScreen(makeCtx());
    const clear = host.querySelector('[part="clear"]') as HTMLElement;
    expect(clear.textContent?.trim()).toBe("Clear all");
    pointer(clear, "click");
    await redraw(host);
    expect(host.querySelectorAll('[part="recent"]')).toHaveLength(0);
  });
});

describe("renderWelcome — GitHub App install prompt", () => {
  const INSTALL_URL = "https://github.com/apps/jx-suite/installations/new";

  test("prompts to install the App when the account has no installations", async () => {
    installMockPlatform({
      getAccountStatus: () => Promise.resolve({ appInstallUrl: INSTALL_URL, installations: [] }),
    });
    await hydrateAccountStatus();
    const host = await renderScreen(makeCtx());
    const link = host.querySelector('[part="link"]') as HTMLElement;
    expect(link.textContent).toContain("Install the Jx Suite GitHub App");
    expect(link.getAttribute("href")).toBe(INSTALL_URL);
    expect(host.textContent).toContain("Repository access");
  });

  test("stays silent with an installation present, without the member, or on unknown status", async () => {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: INSTALL_URL,
          installations: [{ account: "octocat", id: 1 }],
        }),
    });
    await hydrateAccountStatus();
    const screen1 = await renderScreen(makeCtx());
    expect(screen1.textContent).not.toContain("Repository access");

    installMockPlatform(); // No getAccountStatus member at all.
    await hydrateAccountStatus();
    const screen2 = await renderScreen(makeCtx());
    expect(screen2.textContent).not.toContain("Repository access");

    installMockPlatform({ getAccountStatus: () => Promise.reject(new Error("offline")) });
    await hydrateAccountStatus();
    const screen3 = await renderScreen(makeCtx());
    expect(screen3.textContent).not.toContain("Repository access");
  });
});

describe("renderWelcome — project catalogue", () => {
  const CATALOGUE = [
    { name: "Portfolio", root: "sites/portfolio", description: "sites/portfolio" },
    { name: "Shop", root: "acme/shop", description: "write access" },
  ];

  test("lists platform projects and opens one through openRecentProject", async () => {
    installMockPlatform({ listProjects: () => Promise.resolve(CATALOGUE) });
    await hydrateProjectList();
    const ctx = makeCtx();
    const host = await renderScreen(ctx);
    const rows = [
      ...host.querySelectorAll('[part="recent"][data-catalogue]'),
    ] as HTMLButtonElement[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Portfolio");
    expect(rows[1]!.textContent).toContain("write access");
    pointer(rows[1]!, "click");
    expect(ctx.openRecentProject).toHaveBeenCalledWith("acme/shop");
  });

  test("a catalogue entry with no description falls back to its distinguishing folder", async () => {
    installMockPlatform({
      listProjects: () => Promise.resolve([{ name: "Portfolio", root: "/home/dev/w/portfolio" }]),
    });
    await hydrateProjectList();
    const host = await renderScreen(makeCtx());
    expect(texts(host, '[part="recent"][data-catalogue] [part="path"]')).toEqual(["…/w"]);
  });

  test("hides the section when the platform has no catalogue", async () => {
    installMockPlatform();
    const host = await renderScreen(makeCtx());
    expect(host.querySelectorAll('[part="recent"][data-catalogue]')).toHaveLength(0);
  });

  test("entries already in Recent are not duplicated, and Recent renders above the catalogue", async () => {
    seedRecents([{ name: "Portfolio", root: "sites/portfolio", timestamp: 1 }]);
    installMockPlatform({ listProjects: () => Promise.resolve(CATALOGUE) });
    await hydrateProjectList();
    const host = await renderScreen(makeCtx());
    expect(texts(host, '[part="recent"][data-catalogue] [part="name"]')).toEqual(["Shop"]);
    expect(texts(host, '[part="recent"] [part="name"]')).toEqual(["Portfolio", "Shop"]);
  });
});
