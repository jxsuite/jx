/**
 * Tests for src/services/project-adoption.ts — the late-bound project-open slot the AI
 * create_project tool uses to open freshly scaffolded projects.
 */
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  adoptCreatedProject,
  adoptProject,
  setProjectAdopter,
} from "../src/services/project-adoption";
import { workspace } from "../src/workspace/workspace";
import { batchTab, beginBatch, endBatch, isBatching } from "../src/tabs/transact";

describe("project-adoption", () => {
  test("adoptProject throws an actionable error while no adopter is registered", () => {
    expect(adoptProject("/somewhere")).rejects.toThrow("adoption is not available");
  });

  test("adoptProject delegates to the registered adopter", async () => {
    const adopter = mock(async (_root: string) => {});
    setProjectAdopter(adopter);
    await adoptProject("/projects/new-site");
    expect(adopter).toHaveBeenCalledWith("/projects/new-site");
  });

  test("adopter failures propagate to the caller", () => {
    setProjectAdopter(async () => {
      throw new Error("disk on fire");
    });
    expect(adoptProject("/x")).rejects.toThrow("disk on fire");
  });
});

describe("project-adoption — adoptCreatedProject", () => {
  beforeEach(() => {
    resetStudioState();
    workspace.projectRoot = "";
    // A batch left open by a failing case would flush against the next case's tab.
    if (isBatching()) {
      endBatch();
    }
  });

  /** A repo initialiser and an adopter that records the order the two ran in. */
  function seams(onAdopt?: (root: string) => void) {
    const order: string[] = [];
    return {
      order,
      initRepo: mock(async (_root: string) => {
        order.push("initRepo");
        return true;
      }),
      adopt: mock(async (root: string) => {
        order.push("adopt");
        onAdopt?.(root);
      }),
    };
  }

  test("initialises version control BEFORE adopting", async () => {
    // InitProjectRepo is what calls platform.activate(root), which the open flow needs.
    const { adopt, initRepo, order } = seams((root) => {
      workspace.projectRoot = root;
    });

    const outcome = await adoptCreatedProject("/abs/site", { adopt, getTab: () => null, initRepo });

    expect(order).toEqual(["initRepo", "adopt"]);
    expect(initRepo).toHaveBeenCalledWith("/abs/site");
    expect(outcome).toEqual({ adopted: true, error: null, openedElsewhere: false });
  });

  test("a resolved adopter that did not land reports adopted: false", async () => {
    /* `openRecentProject` swallows its failures into a status message, so a resolved promise is not
       proof — the workspace is. Reporting the intent here is how a tool comes to claim it opened a
       project that never opened. */
    const { adopt, initRepo } = seams();

    const outcome = await adoptCreatedProject("/abs/site", { adopt, getTab: () => null, initRepo });

    expect(adopt).toHaveBeenCalled();
    expect(outcome).toEqual({ adopted: false, error: null, openedElsewhere: false });
  });

  test("a throwing adopter is reported, not propagated", async () => {
    const outcome = await adoptCreatedProject("/abs/site", {
      adopt: async () => {
        throw new Error("no such directory");
      },
      getTab: () => null,
      initRepo: async () => false,
    });

    expect(outcome.adopted).toBe(false);
    expect(outcome.error).toBe("no such directory");
  });

  test("a non-Error rejection from the adopter is stringified", async () => {
    /* The adopter is late-bound and third party, so it may reject with anything. The cast is what
       lets the case exist at all — `no-throw-literal` is right about production code. */
    const notAnError = "just a string" as unknown as Error;
    const outcome = await adoptCreatedProject("/abs/site", {
      adopt: async () => {
        throw notAnError;
      },
      getTab: () => null,
      initRepo: async () => false,
    });

    expect(outcome.error).toBe("just a string");
  });

  test("flushes an open undo batch and re-anchors it on the post-adoption tab", async () => {
    /* The agent loop holds a batch on the pre-adoption tab, and adoption replaces every tab in the
       workspace — so a batch left open would close against a tab that no longer exists. */
    const before = resetWorkspaceWithTab(undefined, { documentPath: "/before.json", id: "before" });
    const after = resetWorkspaceWithTab(undefined, { documentPath: "/after.json", id: "after" });
    beginBatch(before);
    expect(batchTab()).toBe(before);

    await adoptCreatedProject("/abs/site", {
      adopt: async (root) => {
        workspace.projectRoot = root;
      },
      getTab: () => after,
      initRepo: async () => false,
    });

    expect(isBatching()).toBe(true);
    expect(batchTab()).toBe(after);
    endBatch();
  });

  test("leaves the batch closed when the caller had none open", async () => {
    await adoptCreatedProject("/abs/site", {
      adopt: async () => {},
      getTab: () => null,
      initRepo: async () => false,
    });

    expect(isBatching()).toBe(false);
  });

  test("defaults to the real adopter and the real repo initialiser", async () => {
    // Neither seam passed: this is the shape both tools call it in.
    const { state } = installMockPlatform();
    const adopter = mock(async (root: string) => {
      workspace.projectRoot = root;
    });
    setProjectAdopter(adopter);

    const outcome = await adoptCreatedProject("/abs/defaulted", { getTab: () => null });

    expect(adopter).toHaveBeenCalledWith("/abs/defaulted");
    expect(outcome.adopted).toBe(true);
    // InitProjectRepo ran for real: it activated the new root, then initialised a repository.
    expect(state.calls.filter(([name]) => name === "activate" || name === "gitInit")).toHaveLength(
      2,
    );
  });

  test("restores this window's backend to the shown project before handing off to a new window", async () => {
    /* `createProject` (which `initRepo` runs through) re-roots THIS window's backend to the new
       root as a side effect of scaffolding — even though a different project ("/abs/old-project")
       is already showing here and `adopt` is about to open the new one in a window of its own. */
    const setWindowProject = mock(async (_root: string) => ({ config: null, deduped: false }));
    installMockPlatform({
      openProjectInNewWindow: mock(async () => ({ focused: false })),
      setWindowProject,
    });
    workspace.projectRoot = "/abs/old-project";
    const { adopt, initRepo, order } = seams();

    const outcome = await adoptCreatedProject("/abs/new-project", {
      adopt,
      getTab: () => null,
      initRepo,
    });

    // Restored BEFORE handing off: a dedupe check for /abs/new-project must not find this window
    // Still claiming it, or the new window never opens.
    expect(order).toEqual(["initRepo", "adopt"]);
    expect(setWindowProject).toHaveBeenCalledWith("/abs/old-project");
    expect(adopt).toHaveBeenCalledWith("/abs/new-project");
    expect(outcome).toEqual({ adopted: false, error: null, openedElsewhere: true });
    // This window's own displayed project is exactly what it was before create ran.
    expect(workspace.projectRoot).toBe("/abs/old-project");
  });

  test("does not restore on a platform with no multi-window support", async () => {
    // No `openProjectInNewWindow` — a single-window platform (dev server, cloud) keeps today's
    // Replace-in-place behavior, and there is nothing to restore this window away from.
    const setWindowProject = mock(async (_root: string) => ({ config: null, deduped: false }));
    installMockPlatform({ setWindowProject });
    workspace.projectRoot = "/abs/old-project";
    const { adopt, initRepo } = seams((root) => {
      workspace.projectRoot = root;
    });

    const outcome = await adoptCreatedProject("/abs/new-project", {
      adopt,
      getTab: () => null,
      initRepo,
    });

    expect(setWindowProject).not.toHaveBeenCalled();
    expect(outcome).toEqual({ adopted: true, error: null, openedElsewhere: false });
  });
});
