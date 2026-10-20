/**
 * Quick publish, `src/publish/publish-quick.ts` over `src/surfaces/publish-quick.json` (studio.md
 * §22.8): the dialog the chevron beside the Publish workspace tab opens.
 *
 * It is mounted into the real dialog layer and read by `part`. What it publishes is every change,
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

const { initLayers } = await import("../src/ui/layers");
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
  document.querySelector<HTMLElement>('#layer-dialog jx-dialog[part="publish-quick"]');
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
  test("counts every change, lists the first few by what happened to them, and says how many more", () => {
    seed(6);
    const view = quick.quickPublishView();
    expect(view.countLine).toBe("6 changes ready");
    expect(view.rows.map((row) => row.tag)).toEqual(["NEW", "EDIT", "DELETED", "RENAMED"]);
    expect(view.more).toBe("+ 2 more");
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

describe("the dialog", () => {
  test("opens once, in the dialog layer, with the list, the destinations and the checks", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    expect(quick.openQuickPublish()).toBe(handle);
    await handle.ready;
    await flush(4);
    expect(part("count")?.textContent).toBe("2 changes ready");
    expect(parts("change-name").map((name) => name.textContent)).toEqual([
      "page-0.json",
      "page-1.json",
    ]);
    expect(parts("destination-card").map((card) => card.dataset.destination)).toEqual([
      "live",
      "review",
    ]);
    expect(part("checks-text")?.textContent).toMatch(/Connect a deploy provider/);
    // The open checks are marked by a kit icon, not a stray "·" glyph at the start of the line.
    expect(part("checks-icon")?.tagName).toBe("JX-ICON");
    const icon = part("checks-icon");
    expect(icon && "name" in icon ? icon.name : null).toBe("warning-circle");
    expect(handle.host.dataset.jxRegion).toBe("overlay.dialog:publish-quick");
  });

  test("Publish now takes every change to the destination, then closes", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    setValue(dialog()!.querySelector<HTMLInputElement>('[part="summary"] input')!, "Ship it");
    await flush(2);
    expect(shell.git.commitMessage).toBe("Ship it");
    dialog()!.dispatchEvent(new CustomEvent("confirm"));
    await flush(8);
    const names = calls.map(([name]) => name);
    expect(names.slice(0, 3)).toEqual(["gitStage", "gitCommit", "gitPush"]);
    expect(dialog()).toBeNull();
  });

  test("a refused publish keeps the dialog up with the reason", async () => {
    seed(2);
    const handle = quick.openQuickPublish();
    await handle.ready;
    await flush(4);
    dialog()!.dispatchEvent(new CustomEvent("confirm"));
    await flush(6);
    expect(dialog()).not.toBeNull();
    expect(part("blocker")?.textContent).toBe("Write a summary of the change first.");
  });

  /* The deploy is an Activity that reports its own failure, and it answers false. The commit has
     landed, but the change set never reached the live site, so the dialog does not close as though
     it had. */
  test("a deploy that did not ship keeps the dialog up", async () => {
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
    dialog()!.dispatchEvent(new CustomEvent("confirm"));
    await flush(10);
    expect(dialog()).not.toBeNull();
  });

  test("the destination is chosen in the dialog and shared with Review changes", async () => {
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
    dialog()!.dispatchEvent(new CustomEvent("secondary"));
    await flush(4);
    expect(dialog()).toBeNull();
    expect(ran).toEqual([{ args: { tab: "review" }, id: "publish.open" }]);
  });

  test("closing by the platform forgets it, so the next open mounts a new one", async () => {
    seed(1);
    const first = quick.openQuickPublish();
    await first.ready;
    await flush(4);
    dialog()!.dispatchEvent(new CustomEvent("close"));
    await flush(2);
    const second = quick.openQuickPublish();
    expect(second).not.toBe(first);
  });
});
