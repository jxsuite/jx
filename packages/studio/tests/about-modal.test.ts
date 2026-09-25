/**
 * Tests for the About dialog — `src/about/about-modal.ts` and `src/surfaces/about.json`.
 *
 * Asserts lifecycle (open once, Escape, Close), the build-metadata rows (which fall back to
 * "dev"/"unknown" under test since the build-time defines are absent), the lazy package list, and
 * that the desktop update section renders only when the platform implements the optional
 * `getAppInfo`.
 *
 * Everything is addressed by `part`, because the dialog is a document: there is no `.about-modal`
 * to find any more, and the box, the scrolling body, the header and the backdrop it used to draw
 * for itself all belong to `jx-dialog` now.
 */
import { flush, installMockPlatform, pointer } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { emptyContext } from "../src/commands/context";

const { aboutCommands, openAboutModal } = await import("../src/about/about-modal");

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

function modalLayer(): HTMLElement {
  return document.querySelector("#layer-dialog") as HTMLElement;
}

function modal(): HTMLElement | null {
  return modalLayer().querySelector('jx-dialog[part="about"]');
}

function metaRow(label: string): string | undefined {
  const rows = [...(modal()?.querySelectorAll('[part="meta-row"]') ?? [])];
  const row = rows.find((r) => r.querySelector('[part="meta-label"]')?.textContent === label);
  return row?.querySelector('[part="meta-value"]')?.textContent ?? undefined;
}

/** Open it and wait for the mount, which is asynchronous now that the body is a document. */
async function open(): Promise<void> {
  openAboutModal();
  await flush();
  await flush();
}

beforeEach(() => {
  installMockPlatform({
    listPackages: async () => [
      { name: "@jxsuite/runtime", version: "9.9.9" },
      { name: "@jxsuite/studio", version: "9.9.9" },
    ],
  });
});

afterEach(async () => {
  /* The dialog dismisses itself, so a test tears it down the way a reader would: the platform's
     `cancel`, which is what Escape raises on a native `<dialog>`. */
  modal()?.dispatchEvent(new Event("cancel", { bubbles: true }));
  await flush();
});

describe("openAboutModal", () => {
  test("renders the dialog with its headline and build metadata", async () => {
    await open();
    expect(modal()).not.toBeNull();
    /* The headline is the dialog's, not a `<h2>` this surface draws — and there is no `sp-underlay`
       any more, because a native `<dialog>` opened with `showModal()` brings its own backdrop. */
    expect(modal()?.querySelector('[part="headline"]')?.textContent).toBe("About Jx Studio");
    expect(modalLayer().querySelector("sp-underlay")).toBeNull();
    // Build-time defines are absent under test → fallbacks.
    expect(metaRow("Version")).toBe("dev");
    expect(metaRow("Build date")).toBe("—");
    expect(metaRow("Commit")).toBe("unknown");
  });

  test("renders external links", async () => {
    await open();
    const links = [...(modal()?.querySelectorAll('[part="links"] a') ?? [])];
    expect(links.map((a) => a.textContent)).toEqual(["GitHub", "Documentation", "License"]);
    expect(links.every((a) => (a as HTMLAnchorElement).href.startsWith("https://"))).toBe(true);
  });

  test("loads the package list lazily, saying which of the three states it is in", async () => {
    /* Three states rather than a boolean: "still loading" and "the platform reported none" are
       different things to say, and one empty list for both tells a reader the app has no packages
       when it may simply not have asked yet. */
    /* A package list this test resolves by hand. The mount is asynchronous now, so there is no
       synchronous moment that is both mounted AND still loading — holding the platform's promise
       open is the only way to observe the first of the three states at all. */
    let settle: (rows: { name: string; version: string }[]) => void = () => {};
    installMockPlatform({
      listPackages: () =>
        new Promise<{ name: string; version: string }[]>((resolve) => {
          settle = resolve;
        }),
    });
    await open();
    expect(modal()?.querySelector('[part="muted"]')?.textContent).toContain("Loading");
    expect(modal()?.querySelector('[part="package-row"]')).toBeNull();
    settle([
      { name: "@jxsuite/runtime", version: "9.9.9" },
      { name: "@jxsuite/studio", version: "9.9.9" },
    ]);
    await flush();
    await flush();
    const rows = [...(modal()?.querySelectorAll('[part="package-row"]') ?? [])];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('[part="package-name"]')?.textContent).toBe("@jxsuite/runtime");
    expect(rows[0]?.querySelector('[part="package-version"]')?.textContent).toBe("9.9.9");
  });

  test("a second open while already open is a no-op", async () => {
    await open();
    await open();
    expect(modalLayer().querySelectorAll('jx-dialog[part="about"]')).toHaveLength(1);
  });
});

describe("desktop update info", () => {
  test("hides the channel/updates rows when getAppInfo is absent", async () => {
    await open();
    expect(metaRow("Channel")).toBeUndefined();
    expect(metaRow("Updates")).toBeUndefined();
  });

  test("shows channel and update status when getAppInfo is present", async () => {
    installMockPlatform({
      listPackages: async () => [],
      getAppInfo: async () => ({
        version: "1.2.3",
        channel: "stable",
        hash: "deadbee",
        updateStatus: "Up to date",
      }),
    });
    await open();
    expect(metaRow("Channel")).toBe("stable");
    expect(metaRow("Updates")).toBe("Up to date");
  });

  test("omits the updates row when getAppInfo reports no status", async () => {
    installMockPlatform({
      listPackages: async () => [],
      getAppInfo: async () => ({ version: "1.2.3", channel: "canary", hash: "deadbee" }),
    });
    await open();
    expect(metaRow("Channel")).toBe("canary");
    expect(metaRow("Updates")).toBeUndefined();
  });

  test("swallows a failing getAppInfo and still renders core metadata", async () => {
    installMockPlatform({
      listPackages: async () => [],
      getAppInfo: async () => {
        throw new Error("rpc down");
      },
    });
    await open();
    expect(modal()).not.toBeNull();
    expect(metaRow("Channel")).toBeUndefined();
    expect(metaRow("Version")).toBe("dev");
  });
});

describe("degraded loading", () => {
  test("a failing listPackages falls back to an empty list", async () => {
    installMockPlatform({
      listPackages: async () => {
        throw new Error("registry down");
      },
    });
    await open();
    expect(modal()?.querySelector('[part="muted"]')?.textContent).toContain("No packages");
  });
});

describe("closing", () => {
  test("the platform's own close takes the dialog down", async () => {
    /* Escape is the platform's, not this surface's: a native `<dialog>` opened with `showModal()`
       answers it and fires `cancel`, which is what the hand-rolled keydown listener this replaced
       was for. */
    await open();
    modal()?.dispatchEvent(new Event("cancel", { bubbles: true }));
    await flush();
    expect(modal()).toBeNull();
  });

  test("offers Close and nothing else — About asks no question", async () => {
    /* `jx-dialog` draws a confirm button labelled OK unless the label is empty, so a dialog that
       only reports something shipped an affirmative answer to nothing. Caught in a browser, not
       here: happy-dom rendered both buttons just as willingly. */
    await open();
    const footer = modal()?.querySelector('[part="footer"]');
    const buttons = [...(footer?.querySelectorAll("button") ?? [])].map((b) =>
      b.textContent?.trim(),
    );
    expect(buttons).toEqual(["Close"]);
    expect(modal()?.querySelector('[part="confirm"]')).toBeNull();
  });

  test("is shown MODALLY, not merely rendered", async () => {
    /* The trap this surface hit: the mount resolving means the DOCUMENT rendered, while the
       element's own template is one `connectedCallback` later — so `showModal` in between found no
       `<dialog>` to open. Every assertion about content passed against a dialog nobody could see. */
    await open();
    const native = modal()?.querySelector("dialog");
    expect(native).not.toBeNull();
    expect(native?.open).toBe(true);
  });

  test("the Close button closes it", async () => {
    await open();
    const btn = modal()?.querySelector('[part="cancel"]') as HTMLElement;
    expect(btn).not.toBeNull();
    pointer(btn, "click");
    await flush();
    expect(modal()).toBeNull();
  });

  test("closing it leaves no slot behind in the layer", async () => {
    // The slot is created per open; one left behind would stack up over an app's lifetime.
    await open();
    expect(modalLayer().childElementCount).toBe(1);
    modal()?.dispatchEvent(new Event("cancel", { bubbles: true }));
    await flush();
    expect(modalLayer().childElementCount).toBe(0);
  });

  test("reopening after a close gets a live dialog, not the closed one's handle", async () => {
    /* The guard the adapter's `finish()` is for: two paths can report the close, and whichever
       lands second must not clear a handle that belongs to the NEXT dialog. */
    await open();
    modal()?.dispatchEvent(new Event("cancel", { bubbles: true }));
    await flush();
    await open();
    expect(modal()).not.toBeNull();
    expect(modalLayer().querySelectorAll('jx-dialog[part="about"]')).toHaveLength(1);
  });
});

describe("the help.about record", () => {
  // About left the rail in P4: it is opened roughly once in an app's lifetime, so it cannot repay a
  // Permanent slot. It stays reachable by name from the palette, and sits at the bottom of the ⬢
  // Studio menu (`commandbar/overflow`) since `group: "9_help"` sorts after every other group there.
  test("is declared once, application-level, at the bottom of the Studio menu and the palette", () => {
    const [record] = aboutCommands();
    expect(aboutCommands()).toHaveLength(1);
    expect(record!.id).toBe("help.about");
    expect(record!.level).toBe("application");
    expect(record!.menus).toEqual(["commandbar/overflow", "palette"]);
    expect(record!.group).toBe("9_help");
    expect(record!.title).toContain("About");
  });

  test("running it opens the dialog", async () => {
    const [record] = aboutCommands();
    await record!.run(emptyContext(), undefined as never);
    await flush();
    await flush();
    expect(modal()).not.toBeNull();
  });
});
