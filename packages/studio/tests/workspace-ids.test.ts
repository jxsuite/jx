/**
 * The five workspaces as declared — `src/workspace/workspace-ids.ts`.
 *
 * A module with no DOM: `view.setWorkspace`'s `args` enum is built from it in the bare Bun process
 * the CI checks run in, so these cases import it directly, with no harness.
 */
import { ICON_NAMES } from "@jxsuite/ui/icons";
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_HOME_MODES,
  WORKSPACE_IDS,
  WORKSPACES,
  homeWorkspaceOfTabId,
  isHomeWorkspace,
  isWorkspaceId,
  workspaceHomeLabel,
  workspaceHomeTabId,
  workspaceInfo,
} from "../src/workspace/workspace-ids";

describe("the ids", () => {
  test("are the five workspaces, in top-bar order", () => {
    expect([...WORKSPACE_IDS]).toEqual(["design", "content", "media", "styles", "publish"]);
    expect(DEFAULT_WORKSPACE).toBe("design");
  });

  test("the records and the ids agree, in both directions and in order", () => {
    expect(WORKSPACES.map((entry) => entry.id)).toEqual([...WORKSPACE_IDS]);
    expect(WORKSPACES.map((entry) => entry.title)).toEqual([
      "Design",
      "Content",
      "Media",
      "Styles",
      "Publish",
    ]);
    for (const id of WORKSPACE_IDS) {
      expect(workspaceInfo(id).id).toBe(id);
    }
  });

  test("every workspace's glyph is one the kit ships, and no two share one", () => {
    for (const entry of WORKSPACES) {
      expect(ICON_NAMES).toContain(entry.icon);
    }
    expect(new Set(WORKSPACES.map((entry) => entry.icon)).size).toBe(WORKSPACES.length);
  });

  test("isWorkspaceId refuses anything undeclared, a stale layout id included", () => {
    expect(isWorkspaceId("styles")).toBe(true);
    for (const value of ["write", "build", "ship", "", "Design", 3, null, undefined]) {
      expect(isWorkspaceId(value)).toBe(false);
    }
  });
});

describe("the homes", () => {
  test("Content, Media and Publish open on a generic home; Design and Styles do not", () => {
    expect(Object.keys(WORKSPACE_HOME_MODES).toSorted()).toEqual(["content", "media", "publish"]);
    expect(WORKSPACE_IDS.filter((id) => isHomeWorkspace(id))).toEqual([
      "content",
      "media",
      "publish",
    ]);
  });

  test("a home's tab id round-trips, and is never a path", () => {
    for (const id of ["content", "media", "publish"] as const) {
      const tabId = workspaceHomeTabId(id);
      expect(tabId).toBe(`workspace://${id}`);
      expect(homeWorkspaceOfTabId(tabId)).toBe(id);
    }
  });

  test("any other id names no home", () => {
    for (const tabId of [
      "pages/index.json",
      "grid://library",
      "workspace://design",
      "workspace://",
    ]) {
      expect(homeWorkspaceOfTabId(tabId)).toBeNull();
      expect(workspaceHomeLabel(tabId)).toBeNull();
    }
  });

  test("a home's chip reads its workspace's title", () => {
    expect(workspaceHomeLabel(workspaceHomeTabId("media"))).toBe("Media");
    expect(workspaceHomeLabel(workspaceHomeTabId("publish"))).toBe("Publish");
  });
});
