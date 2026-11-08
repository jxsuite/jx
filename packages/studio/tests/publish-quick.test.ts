/**
 * Quick publish, `src/publish/publish-quick.ts` over `src/surfaces/publish-quick.json` (studio.md
 * §22.8): the popover the chevron beside the Publish workspace tab opens, hanging from it.
 *
 * It is mounted into the real popover layer and read by `part`. What it publishes is every change,
 * through the same verb Review changes runs, so the assertions are about what reached git.
 */
import {
  flush,
  installMockPlatform,
  mountOverlayLayers,
  resetStudioState,
  setValue,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { GitStatusResult } from "../src/types";
import type { AnyCommand } from "../src/commands/registry";

const { initLayers, layerHost } = await import("../src/ui/layers");
const { createCommandRegistry } = await import("../src/commands/registry");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { makeContext } = await import("../src/commands/context");
const { resetProjectShell, shell } = await import("../src/shell");
const quick = await import("../src/publish/publish-quick");

function files(count: number): GitStatusResult["files"] {
  const letters = ["A", "M", "D", "R", "U", "M"];
  return Array.from({ length: count }, (_, index) => ({
    path: `pages/page-${index}.json`,
    staged: index === 0,
    status: letters[index % letters.length] ?? "M",
  }));
}

let calls: unknown[][] = [];
const ran: { id: string; args: unknown }[] = [];

function seed(count: number) {
  const status: GitStatusResult = {
    ahead: 0,
    behind: 0,
    branch: "main",
    files: files(count),
    isRepo: true,
    remotes: ["origin"],
  };
  shell.git.status = status;
  shell.git.branches = { branches: ["main"], current: "main" };
  const installed = installMockPlatform({
    gitBranches: async () => ({ branches: ["main"], current: "main" }),
    gitStatus: async () => ({ ...status, files: [] }),
  });
  ({ calls } = installed.state);
}

const dialog = () =>
  layerHost("popover").querySelector<HTMLElement>('jx-popover[part="publish-quick"]');
const part = (name: string) => dialog()?.querySelector<HTMLElement>(`[part="${name}"]`) ?? null;
const parts = (name: string) => [
  ...(dialog()?.querySelectorAll<HTMLElement>(`[part="${name}"]`) ?? []),
];

beforeEach(() => {
  mountOverlayLayers(document.body);
  initLayers();
  resetProjectShell();
  resetStudioState({ name: "Demo", projectConfig: { name: "Demo" }, projectRoot: "/p" });
  ran.length = 0;
  const registry = createCommandRegistry({
    getContext: () => makeContext({ project: { open: true } }),
  });
  const record: AnyCommand = {
    category: "Publish",
    id: "publish.open",
    level: "project",
    run: (_ctx, args) => {
      ran.push({ args, id: "publish.open" });
    },
    title: "Show Publish",
  };
  registry.register(record);
  setActiveRegistry(registry);
});

afterEach(() => {
  quick.closeQuickPublish();
  setActiveRegistry(null);
  document.body.textContent = "";
});

describe("the view", () => {
  test("counts every change, names the first few as the site does, and sums up the rest", () => {
    seed(6);
    const view = quick.quickPublishView();
    expect(view.countLine).toBe("6 changes ready");
    expect(view.rows.map((row) => [row.tag, row.tagKind, row.label, row.note])).toEqual([
      ["NEW", "new", "Page 0", ""],
      ["EDIT", "edit", "Page 1", ""],
      ["DELETE", "delete", "Page 2", ""],
      ["RENAME", "rename", "Page 3", ""],
    ]);
    // The file is the row's tooltip: what is committed, one hover away.
    expect(view.rows[0]?.path).toBe("pages/page-0.json");
    expect(view.more).toBe("+ 2 pages");
    expect(view.hasMore).toBe(true);
    // Every change is taken, so a file left out of Review changes does not block it.
    expect(view.blocker).toBe("Write a summary of the change first.");
  });

  test("with nothing changed, it says so and offers nothing to send", () => {
    seed(0);
    const view = quick.quickPublishView();
    expect(view.countLine).toBe("Nothing to publish");
    expect(view.listState).toBe("empty");
    expect(view.blocked).toBe(true);
  });

  test("one change reads in the singular, and an unknown letter is an edit", () => {
    seed(1);
    shell.git.status!.files[0]!.status = "X";
    const view = quick.quickPublishView();
    expect(view.countLine).toBe("1 change ready");
    expect(view.rows[0]?.tag).toBe("EDIT");
  });
});

describe("the panel", () => {
  test("opens once, in the popover layer, with the list, the destinations and the checks", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    expect(quick.openQuickPublish()).toBe(handle);
    await handle.ready;
    await flush(4);
    expect(part("count")?.textContent).toBe("2 changes ready");
    expect(parts("change-name").map((name) => name.textContent)).toEqual(["Page 0", "Page 1"]);
    expect(parts("change").map((row) => row.dataset.tag)).toEqual(["new", "edit"]);
    expect(parts("destination-card").map((card) => card.dataset.destination)).toEqual([
      "live",
      "review",
    ]);
    expect(part("checks-text")?.textContent).toMatch(/Connect a deploy provider/);
    // The open checks are marked by a kit icon, not a stray "·" glyph at the start of the line.
    expect(part("checks-icon")?.tagName).toBe("JX-ICON");
    const icon = part("checks-icon");
    expect(icon && "name" in icon ? icon.name : null).toBe("warning-circle");
    expect(handle.host.dataset.jxRegion).toBe("overlay.menu:publish-quick");
  });

  test("Publish now takes every change to the destination, then closes", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    setValue(dialog()!.querySelector<HTMLInputElement>('[part="summary"] input')!, "Ship it");
    await flush(2);
    expect(shell.git.commitMessage).toBe("Ship it");
    part("publish-now")!.click();
    await flush(8);
    const names = calls.map(([name]) => name);
    expect(names.slice(0, 3)).toEqual(["gitStage", "gitCommit", "gitPush"]);
    expect(dialog()).toBeNull();
  });

  test("a refused publish keeps the panel up with the reason", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    part("publish-now")!.click();
    await flush(6);
    expect(dialog()).not.toBeNull();
    expect(part("blocker")?.textContent).toBe("Write a summary of the change first.");
  });

  /* The deploy is an Activity that reports its own failure, and it answers false. The commit has
     landed, but the change set never reached the live site, so the panel does not close as though
     it had. */
  test("a deploy that did not ship keeps the panel up", async () => {
    seed(2);
    installMockPlatform({
      cfApi: async () => [],
      gitBranches: async () => ({ branches: ["main"], current: "main" }),
      gitPush: async () => {
        throw new Error("rejected");
      },
      gitStatus: async () => shell.git.status!,
    });
    resetStudioState({
      name: "Demo",
      projectConfig: {
        build: {
          deploy: {
            accountId: "a".repeat(32),
            projectName: "my-site",
            provider: "cloudflare-pages",
          },
        },
        name: "Demo",
      },
      projectRoot: "/p",
    });
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    setValue(dialog()!.querySelector<HTMLInputElement>('[part="summary"] input')!, "Ship it");
    await flush(2);
    part("publish-now")!.click();
    await flush(10);
    expect(dialog()).not.toBeNull();
  });

  test("the destination is chosen in the panel and shared with Review changes", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    dialog()!
      .querySelector<HTMLElement>('[data-destination="review"][part="destination-card"]')!
      .click();
    await flush(2);
    expect(shell.publish.destination).toBe("review");
  });

  test("Review all closes it and opens the workspace on Review changes", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    part("review-all")!.click();
    await flush(4);
    expect(dialog()).toBeNull();
    expect(ran).toEqual([{ args: { tab: "review" }, id: "publish.open" }]);
  });

  test("closing by the platform forgets it, so the next open mounts a new one", async () => {
    seed(1);
    const first = quick.openQuickPublish();
    await first.ready;
    await flush(4);
    dialog()!.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
    await flush(2);
    const second = quick.openQuickPublish();
    expect(second).not.toBe(first);
  });

  test("closing it twice says it is over once", async () => {
    seed(1);
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    handle.close();
    handle.close();
    await flush(2);
    // The first close forgot it; the second found nothing left to say, so the next open is new.
    expect(quick.openQuickPublish()).not.toBe(handle);
  });
});

describe("what a change touches, and where the panel hangs", () => {
  test("a changed template says how many pages it changes, once they are counted", async () => {
    const status: GitStatusResult = {
      ahead: 0,
      behind: 0,
      branch: "main",
      files: [
        { path: "layouts/base.json", staged: false, status: "M" },
        { path: "layouts/old.json", staged: false, status: "D" },
      ],
      isRepo: true,
      remotes: ["origin"],
    };
    shell.git.status = status;
    installMockPlatform(
      {
        listDirectory: async (dir: string) =>
          dir === "pages"
            ? [
                { name: "index.json", path: "pages/index.json", type: "file" as const },
                { name: "about.json", path: "pages/about.json", type: "file" as const },
                { name: "plain.json", path: "pages/plain.json", type: "file" as const },
                { name: "post.json", path: "pages/post.json", type: "file" as const },
              ]
            : [],
      },
      {
        "layouts/base.json": JSON.stringify({ tagName: "div" }),
        "pages/about.json": JSON.stringify({ $layout: false, tagName: "div" }),
        "pages/index.json": JSON.stringify({ tagName: "div" }),
        "pages/plain.json": JSON.stringify({ $layout: "./layouts/base.json", tagName: "div" }),
        // Drawn in a layout that is itself drawn in the changed one: the chain is followed.
        "layouts/article.json": JSON.stringify({ $layout: "./layouts/base.json", tagName: "div" }),
        "pages/post.json": JSON.stringify({ $layout: "./layouts/article.json", tagName: "div" }),
      },
    );
    resetStudioState({
      name: "Demo",
      projectConfig: { defaults: { layout: "./layouts/base.json" }, name: "Demo" },
      projectRoot: "/p",
    });
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(10);
    expect(quick.quickPublishView().rows.map((row) => [row.label, row.note])).toEqual([
      ["Base", "affects 3 pages"],
      ["Old", ""],
    ]);
    expect(parts("change-note").map((note) => note.textContent)).toEqual(["affects 3 pages", ""]);
  });

  test("the rest are summed up by kind, in the singular where there is one", () => {
    const item = (path: string, noun: string, nounPlural: string) => ({
      included: false,
      kind: "",
      label: path,
      noun,
      nounPlural,
      path,
      refusal: "",
      status: "M",
      summary: "",
      tag: "edit" as const,
      tagLabel: "EDIT",
      url: "",
    });
    expect(
      quick.moreLine([
        item("content/posts/a.md", "post", "posts"),
        item("public/a.png", "image", "images"),
        item("public/b.png", "image", "images"),
      ]),
    ).toBe("+ 1 post, 2 images");
    expect(quick.moreLine([])).toBe("");
  });

  test("it hangs from the chevron that runs it", async () => {
    seed(1);
    const chevron = document.createElement("button");
    chevron.dataset.command = "publish.quick";
    document.body.append(chevron);
    const shown: (Element | undefined)[] = [];
    const original = HTMLElement.prototype.showPopover;
    HTMLElement.prototype.showPopover = function showPopover(
      this: HTMLElement,
      options?: { source?: Element },
    ) {
      shown.push(options?.source);
      original.call(this);
    };
    try {
      const handle = quick.openQuickPublish();
      await handle.ready;
      await flush(4);
    } finally {
      HTMLElement.prototype.showPopover = original;
    }
    expect(shown.at(-1)).toBe(chevron);
  });
});
