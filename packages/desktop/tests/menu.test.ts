import { beforeEach, describe, expect, mock, test } from "bun:test";

// ─── Mock electrobun/main (ApplicationMenu) ─────────────────────────────────

interface MenuItem {
  label?: string;
  action?: string;
  accelerator?: string;
  type?: string;
  role?: string;
  submenu?: MenuItem[];
}

/** The payload Electrobun emits for `application-menu-clicked`: the clicked item's `data`. */
interface MenuClick {
  data: { action?: string };
}

type MenuClickHandler = (event: MenuClick) => void | Promise<void>;

let capturedMenu: MenuItem[] = [];
let clickHandler: MenuClickHandler | null = null;
const setApplicationMenu = mock((menu: MenuItem[]) => {
  capturedMenu = menu;
});
const on = mock((name: string, handler: MenuClickHandler) => {
  if (name === "application-menu-clicked") {
    clickHandler = handler;
  }
});

void mock.module("electrobun/main", () => ({
  ApplicationMenu: { on, setApplicationMenu },
}));

// ─── Mock ./utils and ./window-manager ──────────────────────────────────────

const openFileDialog = mock(async (): Promise<string | null> => null);
void mock.module("../src/utils", () => ({
  openDirectoryDialog: mock(async (): Promise<string | null> => null),
  openFileDialog,
}));

const openProjectWindow = mock((_root: string | null) => ({}));
void mock.module("../src/window-manager", () => ({ openProjectWindow }));

// ─── Import module under test ────────────────────────────────────────────────

const { installApplicationMenu } = await import("../src/menu");

function fire(action?: string): Promise<void> {
  return Promise.resolve(clickHandler!({ data: action == null ? {} : { action } }));
}

beforeEach(() => {
  setApplicationMenu.mockClear();
  on.mockClear();
  openFileDialog.mockClear();
  openProjectWindow.mockClear();
  openFileDialog.mockResolvedValue(null);
});

describe("installApplicationMenu", () => {
  test("registers a File menu with the multi-window entry points", () => {
    installApplicationMenu();
    expect(setApplicationMenu).toHaveBeenCalledTimes(1);
    const file = capturedMenu.find((m) => m.label === "File")!;
    expect(file).toBeDefined();
    const actions = file.submenu!.map((i) => i.action ?? i.role ?? i.type);
    expect(actions).toEqual(["new-window", "open-project", "divider", "close"]);
    expect(on).toHaveBeenCalledWith("application-menu-clicked", expect.any(Function));
  });

  test("claims no accelerator, because the command records own both chords", () => {
    // ⌘⇧N and ⌘O are `view.newWindow` and `project.open`, which the shell dispatches on every
    // Launcher. A chord with two owners fires twice — two welcome windows from one press.
    installApplicationMenu();
    const file = capturedMenu.find((m) => m.label === "File")!;
    expect(file.submenu!.map((item) => item.accelerator)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("new-window action opens a welcome window", async () => {
    installApplicationMenu();
    await fire("new-window");
    expect(openProjectWindow).toHaveBeenCalledWith(null);
  });

  test("open-project opens the chosen project's directory", async () => {
    installApplicationMenu();
    openFileDialog.mockResolvedValueOnce("/home/me/site/project.json");
    await fire("open-project");
    expect(openFileDialog).toHaveBeenCalledTimes(1);
    expect(openProjectWindow).toHaveBeenCalledWith("/home/me/site");
  });

  test("open-project ignores a non-project.json selection", async () => {
    installApplicationMenu();
    openFileDialog.mockResolvedValueOnce("/home/me/site/readme.md");
    await fire("open-project");
    expect(openFileDialog).toHaveBeenCalledWith();
    expect(openProjectWindow).not.toHaveBeenCalled();
  });

  test("open-project does nothing when the dialog is cancelled", async () => {
    installApplicationMenu();
    openFileDialog.mockResolvedValueOnce(null);
    await fire("open-project");
    expect(openFileDialog).toHaveBeenCalledWith();
    expect(openProjectWindow).not.toHaveBeenCalled();
  });

  test("ignores clicks with an unknown or missing action", async () => {
    installApplicationMenu();
    await fire("some-other-action");
    await fire();
    // The known action, fired last, is the only one that reaches a window.
    await fire("new-window");
    expect(openProjectWindow.mock.calls).toEqual([[null]]);
    expect(openFileDialog).not.toHaveBeenCalled();
  });
});
