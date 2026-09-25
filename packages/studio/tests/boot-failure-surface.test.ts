/**
 * The boot-failure screen (`src/surfaces/boot-failure.ts` + `.json`) and the tree mount that puts
 * it where the frame would have gone (`src/shell/tree.ts`'s `mountBootFailureTree`).
 *
 * The view is pinned as text because its reader is a customer with no console: desktop 5.0.0-5.1.3
 * failed with every panel drawn and "Failed to fetch" on the first click, and the whole point of
 * this screen is that the next report arrives with the recorded error and the support facts
 * attached. The facts line is pinned WITHOUT the query string, because the Chromium launcher's
 * window carries its auth token there.
 */
import { flush } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  bootFailureReport,
  bootFailureView,
  mountBootFailureSurface,
} from "../src/surfaces/boot-failure";
import { mountBootFailureTree } from "../src/shell/tree";
import { APP_NAME, GIT_COMMIT, VERSION } from "../src/version";
import type { LauncherSignal } from "../src/platform";

const g = globalThis as unknown as { __jxLauncher?: LauncherSignal };
const PAGE = { href: "views://studio/index.html" };

const hosts: HTMLElement[] = [];

async function draw(
  refusal: Parameters<typeof mountBootFailureSurface>[1],
  page = PAGE,
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  await mountBootFailureSurface(host, refusal, page);
  await flush();
  return host;
}

function part(root: ParentNode, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[part="${name}"]`);
}

/** A kit button's native control — the node a press has to reach (see empty-state-surface). */
function control(button: Element | null): HTMLButtonElement {
  return button!.querySelector<HTMLButtonElement>('[part="control"]')!;
}

const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

beforeEach(() => {
  delete g.__jxLauncher;
});

afterEach(() => {
  delete g.__jxLauncher;
  for (const host of hosts.splice(0)) {
    host.remove();
  }
  if (originalClipboard) {
    Object.defineProperty(globalThis.navigator, "clipboard", originalClipboard);
  } else {
    delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
  }
});

describe("bootFailureView", () => {
  test("a failed launcher: the bridge failed to start, and the fix is a reinstall", () => {
    const view = bootFailureView({ kind: "launcher", launcher: "electrobun" }, PAGE);
    expect(view.title).toBe("Jx Studio couldn't connect to its backend");
    expect(view.lead).toContain("desktop app's bridge to its backend failed to start");
    expect(view.lead).toContain("reinstalling the latest release from the download page");
    expect(view.facts).toBe(
      `${APP_NAME} bundle ${VERSION} (${GIT_COMMIT}) · launcher electrobun · views://studio/index.html`,
    );
  });

  test("a declared boot module that never ran says the startup script never ran", () => {
    const view = bootFailureView({ kind: "declared" }, PAGE);
    expect(view.lead).toContain("startup script never ran");
    // Nothing announced, so no launcher is named.
    expect(view.facts).toContain("· launcher none ·");
  });

  test("a backendless scheme names the scheme", () => {
    const view = bootFailureView({ kind: "scheme", protocol: "file:" }, { href: "file:///x.html" });
    expect(view.lead).toContain("opened from a file: URL");
    expect(view.facts.endsWith("· file:///x.html")).toBe(true);
  });

  test("the detail is the launcher's recorded error, message and stack, read at render time", () => {
    const refusal = { kind: "launcher", launcher: undefined } as const;
    // Recorded AFTER the refusal was decided: the view still sees it.
    g.__jxLauncher = {
      error: {
        message: "Electrobun 2.x APIs come from the Hutch devkit, not node_modules.",
        stack:
          "Error: Electrobun 2.x APIs come from the Hutch devkit, not node_modules.\n    at init.js:13222",
      },
      launcher: "electrobun",
    };
    const view = bootFailureView(refusal, PAGE);
    expect(view.hasDetail).toBe(true);
    // The V8 stack already opens with the message, so it is printed once.
    expect(view.detail).toBe(g.__jxLauncher.error!.stack!);
    // The refusal carried no name; the signal's own is used.
    expect(view.facts).toContain("· launcher electrobun ·");
  });

  test("a stack that does not contain the message gets the message above it", () => {
    g.__jxLauncher = { error: { message: "boom", stack: "@views://studio/dist/init.js:1:1" } };
    const view = bootFailureView({ kind: "launcher", launcher: "chromium" }, PAGE);
    expect(view.detail).toBe("boom\n@views://studio/dist/init.js:1:1");
    expect(view.facts).toContain("· launcher chromium ·");
  });

  test("a bare message is the whole detail", () => {
    g.__jxLauncher = { error: { message: "boom" } };
    expect(bootFailureView({ kind: "launcher", launcher: undefined }, PAGE).detail).toBe("boom");
  });

  test("no recorded error: no detail", () => {
    g.__jxLauncher = {};
    const view = bootFailureView({ kind: "launcher", launcher: undefined }, PAGE);
    expect(view.detail).toBe("");
    expect(view.hasDetail).toBe(false);
    expect(view.facts).toContain("· launcher none ·");
  });

  test("the facts never carry the query string or the fragment — the Chromium token lives there", () => {
    const view = bootFailureView(
      { kind: "launcher", launcher: "chromium" },
      { href: "http://127.0.0.1:4100/__studio__/index.html?token=secret#frag" },
    );
    expect(view.facts).not.toContain("token");
    expect(view.facts).not.toContain("secret");
    expect(view.facts).not.toContain("frag");
    expect(view.facts.endsWith("· http://127.0.0.1:4100/__studio__/index.html")).toBe(true);
  });

  test("the page defaults to the live location", () => {
    expect(bootFailureView({ kind: "declared" }).facts).toContain(location.href.split(/[?#]/u)[0]!);
  });

  test("the report is everything the screen says, in order, with no empty paragraphs", () => {
    const view = bootFailureView({ kind: "declared" }, PAGE);
    expect(bootFailureReport(view)).toBe(`${view.title}\n\n${view.lead}\n\n${view.facts}`);
    g.__jxLauncher = { error: { message: "boom" } };
    const withDetail = bootFailureView({ kind: "launcher", launcher: undefined }, PAGE);
    expect(bootFailureReport(withDetail)).toContain("\n\nboom\n\n");
  });
});

describe("the boot-failure document", () => {
  test("renders an alert with the title, the lead, the facts and both actions", async () => {
    const host = await draw({ kind: "declared" });
    const screen = part(host, "screen")!;
    expect(screen.getAttribute("role")).toBe("alert");
    expect(part(host, "title")?.textContent).toBe("Jx Studio couldn't connect to its backend");
    expect(part(host, "lead")?.textContent).toContain("startup script never ran");
    expect(part(host, "facts")?.textContent).toContain("views://studio/index.html");
    expect(part(host, "detail")).toBeNull();
    expect(part(host, "reload")?.textContent?.trim()).toBe("Reload");
    expect(part(host, "copy")?.textContent?.trim()).toBe("Copy details");
    // The window's handle, since the desktop window hides its title bar.
    expect(part(host, "drag-strip")?.classList.contains("electrobun-webkit-app-region-drag")).toBe(
      true,
    );
  });

  test("draws the recorded error when there is one", async () => {
    g.__jxLauncher = { error: { message: "boom" }, launcher: "electrobun" };
    const host = await draw({ kind: "launcher", launcher: "electrobun" });
    expect(part(host, "detail")?.textContent).toBe("boom");
  });

  test("Reload reloads the page", async () => {
    const reload = mock(() => {});
    const original = Object.getOwnPropertyDescriptor(location, "reload");
    Object.defineProperty(location, "reload", { configurable: true, value: reload });
    try {
      const host = await draw({ kind: "declared" });
      control(part(host, "reload")).click();
      await flush();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      if (original) {
        Object.defineProperty(location, "reload", original);
      } else {
        delete (location as { reload?: unknown }).reload;
      }
    }
  });

  test("Copy details writes the report and says it did", async () => {
    const written: string[] = [];
    stubClipboard(async (text) => {
      written.push(text);
    });
    g.__jxLauncher = { error: { message: "boom" } };
    const host = await draw({ kind: "launcher", launcher: undefined });
    control(part(host, "copy")).click();
    await flush();
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(
      bootFailureReport(bootFailureView({ kind: "launcher", launcher: undefined }, PAGE)),
    );
    expect(part(host, "copy")?.textContent?.trim()).toBe("Copied");
  });

  test("a refused clipboard write does not throw, and the button does not claim success", async () => {
    stubClipboard(() => Promise.reject(new Error("NotAllowedError")));
    const host = await draw({ kind: "declared" });
    control(part(host, "copy")).click();
    await flush();
    expect(part(host, "copy")?.textContent?.trim()).toBe("Copy details");
  });
});

describe("mountBootFailureTree", () => {
  test("replaces whatever the shell root held with the screen alone", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const root = document.createElement("div");
    root.id = "shell-root";
    root.innerHTML = `<div id="app"></div><div id="layer-toast"></div>`;
    host.append(root);

    await mountBootFailureTree({ kind: "declared" }, host);
    await flush();

    expect(host.querySelectorAll("#shell-root")).toHaveLength(1);
    expect(root.querySelector("#app")).toBeNull();
    expect(root.querySelector("#layer-toast")).toBeNull();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
  });

  test("creates the shell root when there is none, in the document body by default", async () => {
    document.querySelector("#shell-root")?.remove();
    await mountBootFailureTree({ kind: "scheme", protocol: "views:" });
    await flush();
    const root = document.body.querySelector("#shell-root")!;
    hosts.push(root as HTMLElement);
    expect(root.querySelector('[part="lead"]')?.textContent).toContain("views: URL");
  });
});
