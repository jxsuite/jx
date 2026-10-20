import { resetWorkspaceWithTab } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { shell } from "../src/shell";
import { PROJECT_STYLES_VIEW, PROJECT_VARIABLES_VIEW } from "../src/style/project-styles";
import { stylebookTarget } from "../src/style/stylebook-target";

afterEach(() => {
  shell.stylebook.selection = null;
});

describe("stylebookTarget", () => {
  test("is the picked tag exactly while the tab draws the Elements view", () => {
    const tab = resetWorkspaceWithTab();
    shell.stylebook.selection = "h1";
    tab.session.ui.canvasMode = PROJECT_STYLES_VIEW;
    expect(stylebookTarget(tab)).toBe("h1");
    tab.session.ui.canvasMode = PROJECT_VARIABLES_VIEW;
    expect(stylebookTarget(tab)).toBeNull();
    tab.session.ui.canvasMode = "design";
    expect(stylebookTarget(tab)).toBeNull();
  });

  test("is null with no tab, or with nothing picked", () => {
    const tab = resetWorkspaceWithTab();
    tab.session.ui.canvasMode = PROJECT_STYLES_VIEW;
    expect(stylebookTarget(tab)).toBeNull();
    shell.stylebook.selection = "p";
    expect(stylebookTarget(null)).toBeNull();
  });
});
