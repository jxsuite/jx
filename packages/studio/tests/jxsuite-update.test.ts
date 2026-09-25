/**
 * Src/packages/jxsuite-update.ts — the on-open @jxsuite update prompt, and the document it draws.
 *
 * Two things are under test and they are deliberately kept apart. The FLOW's behaviour is the one
 * that changed most recently: the target is each package's own newest published version, read from
 * the registry through `platform.packageVersions()`, not the version this Studio build embeds — so
 * the cases that matter are the ones a suite-wide target got wrong. The SURFACE is
 * `src/surfaces/jxsuite-update.json`, addressed by `part` and `data-package` because there is no
 * class left to find: the rows used to be one `\n`-joined string inside a `<span>` with a
 * `white-space: pre-line`, which a test could only match a substring of.
 */
import { flush, installMockPlatform } from "./harness";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { REGION_ATTR } from "../src/ui/regions";
import { problems, resetNotifications } from "../src/services/notify";
import { resetActivities } from "../src/panels/activity-panel";
import type { PackageVersionInfo } from "@jxsuite/protocol";
import type { StudioPlatform } from "../src/types";

const { applyJxsuiteUpdate, checkJxsuiteUpdate, maybePromptJxsuiteUpdate } =
  await import("../src/packages/jxsuite-update");

beforeAll(() => {
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    if (!document.querySelector(`#${id}`)) {
      const el = document.createElement("div");
      el.id = id;
      document.body.append(el);
    }
  }
  initLayers();
});

/** The offer, or null. Named by its own `part`, so a stray dialog cannot answer for it. */
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#layer-dialog jx-dialog[part="jxsuite-update"]');
}

/**
 * Wait for the offer to land.
 *
 * A poll rather than a fixed count of flushes: the registry lookup is awaited before the dialog is
 * opened at all, and `jx-dialog` settles its own template one `connectedCallback` after the
 * document has rendered — so the number of turns between "the flow was called" and "the dialog is
 * addressable" is not a constant worth writing down (specs/studio-ui-guidelines.md §1.1).
 */
async function openedDialog(): Promise<HTMLElement> {
  for (let i = 0; i < 20 && !dialog(); i++) {
    await flush();
  }
  const element = dialog();
  expect(element).not.toBeNull();
  return element!;
}

/** Every row the offer prints, as `name` → the version move beside it. */
function rows(element: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of element.querySelectorAll<HTMLElement>("[data-package]")) {
    out[row.dataset.package!] = row.querySelector('[part="package-move"]')!.textContent!;
  }
  return out;
}

/** A host whose registry lookup answers with `reported`. */
function withRegistry(reported: PackageVersionInfo[], extra: Partial<StudioPlatform> = {}) {
  installMockPlatform({ packageVersions: async () => reported, ...extra });
}

afterEach(() => {
  localStorage.clear();
  (document.querySelector("#layer-dialog") as HTMLElement).innerHTML = "";
  (document.querySelector("#layer-modal") as HTMLElement).innerHTML = "";
  resetNotifications();
  resetActivities();
});

describe("checkJxsuiteUpdate", () => {
  test("each package is measured against ITS OWN latest, not one suite-wide number", async () => {
    /*
     * The case the old code could not express. Three @jxsuite packages on three different versions,
     * two behind their own latest by different amounts — and a single target would have proposed
     * one version for all three, at least two of which were never published.
     */
    withRegistry([
      { current: "^1.2.0", dev: true, latest: "1.4.0", name: "@jxsuite/parser" },
      { current: "^2.0.1", latest: "2.3.0", name: "@jxsuite/runtime" },
      { current: "^0.9.0", latest: "0.9.0", name: "@jxsuite/schema" },
      { current: "^4.0.0", latest: "4.6.0", name: "hono" },
    ]);
    const outdated = await checkJxsuiteUpdate();
    expect(outdated).toEqual([
      { current: "^1.2.0", dev: true, latest: "1.4.0", name: "@jxsuite/parser" },
      { current: "^2.0.1", dev: false, latest: "2.3.0", name: "@jxsuite/runtime" },
    ]);
  });

  test("a project pinned AHEAD of the registry is not offered a downgrade", async () => {
    // `packageVersions` reports any DIFFERENCE from latest. A prerelease, or a range bumped before
    // The publish landed, is not something to "update".
    withRegistry([{ current: "^2.0.0", latest: "1.9.0", name: "@jxsuite/runtime" }]);
    expect(await checkJxsuiteUpdate()).toEqual([]);
  });

  test("nothing to do when no @jxsuite package is behind", async () => {
    withRegistry([{ current: "^4.0.0", latest: "4.6.0", name: "hono" }]);
    expect(await checkJxsuiteUpdate()).toEqual([]);
  });

  test("an unreachable registry is silence, not an error", async () => {
    // This runs on project open. Being offline is not something to interrupt the author about.
    withRegistry([]);
    installMockPlatform({
      packageVersions: async () => {
        throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
      },
    });
    expect(await checkJxsuiteUpdate()).toEqual([]);
  });

  test("a host with no registry lookup at all gets no prompt", async () => {
    // The cloud session manages dependencies server-side and offers no `packageVersions`. Without
    // The registry there is no honest target, and guessing one is what this module stopped doing.
    installMockPlatform({});
    expect(await checkJxsuiteUpdate()).toEqual([]);
  });
});

describe("maybePromptJxsuiteUpdate", () => {
  test("never prompts in automation mode, and never asks the registry", async () => {
    // The same read-only rule ensure-deps.ts states, and for a second reason on top of it: the
    // Offer is a modal `<dialog>`, and a modal dialog makes the rest of the page inert. Raised at
    // Boot, it sent every click a screenshot shot dispatched to nothing at all — which is how this
    // Dialog ended up in the middle of 33 committed images, `docs/images/hero.png` (the
    // Jxsuite.com marketing hero) among them.
    //
    // Correct dependency pins do not make this unnecessary: `packageVersions` compares the range's
    // BASE version against the registry's `latest`, so a project pinned `^1.4.1` is "outdated" the
    // Moment 1.4.2 publishes, and every starter shot would be blocked again by the next patch
    // Release of any @jxsuite package.
    const { happyDOM } = globalThis as unknown as { happyDOM: { setURL: (u: string) => void } };
    happyDOM.setURL("http://localhost:3000/packages/studio/index.html?automation=1");
    let asked = 0;
    let wrote = 0;
    installMockPlatform({
      packageVersions: async () => {
        asked += 1;
        return [{ current: "^1.2.0", latest: "1.4.0", name: "@jxsuite/parser" }];
      },
      setPackageVersions: async () => {
        wrote += 1;
        return { ok: true };
      },
    });
    try {
      await maybePromptJxsuiteUpdate("/project");
      await flush();
      expect(dialog()).toBeNull();
      expect(asked).toBe(0);
      expect(wrote).toBe(0);
    } finally {
      happyDOM.setURL("http://localhost:3000/packages/studio/index.html");
    }
  });

  test("still prompts when automation is not requested", async () => {
    // The guard must key on the flag, not on merely being in a test.
    withRegistry([{ current: "^1.2.0", latest: "1.4.0", name: "@jxsuite/parser" }], {
      setPackageVersions: async () => ({ ok: true }),
    });
    const p = maybePromptJxsuiteUpdate("/project-not-automated");
    const element = await openedDialog();
    element.dispatchEvent(new Event("cancel"));
    await p;
    await flush();
  });

  test("the offer names every package and the range Update would write", async () => {
    /*
     * The row's second half is the flow's own `^${latest}` — the same string `setPackageVersions`
     * is handed below — so the dialog cannot promise a range the install would not produce. It was
     * one `\n`-joined string in a `<span style="white-space: pre-line">` before, which announced as
     * a single run-on line and could not be addressed per package at all.
     */
    withRegistry([
      { current: "^1.2.0", dev: true, latest: "1.4.0", name: "@jxsuite/parser" },
      { current: "^2.0.1", latest: "2.3.0", name: "@jxsuite/runtime" },
    ]);
    installMockPlatform({
      packageVersions: async () => [
        { current: "^1.2.0", dev: true, latest: "1.4.0", name: "@jxsuite/parser" },
        { current: "^2.0.1", latest: "2.3.0", name: "@jxsuite/runtime" },
      ],
      setPackageVersions: async () => ({ ok: true }),
    });
    const p = maybePromptJxsuiteUpdate("/project-rows");
    const element = await openedDialog();

    expect(rows(element)).toEqual({
      "@jxsuite/parser": "^1.2.0 → ^1.4.0",
      "@jxsuite/runtime": "^2.0.1 → ^2.3.0",
    });
    // What the reader sees, and what names the dialog: the labels are properties on the element,
    // So the assertion is on what `jx-dialog` drew from them rather than on the attributes.
    expect(element.querySelector('[part="headline"]')?.textContent).toBe(
      "Update @jxsuite packages?",
    );
    expect(element.querySelector('dialog[part="dialog"]')?.getAttribute("aria-label")).toBe(
      "Update @jxsuite packages?",
    );
    expect(element.querySelector('[part="confirm-label"]')?.textContent).toBe("Update");
    expect(element.querySelector('[part="cancel-label"]')?.textContent).toBe("Not now");
    // The slot the document was mounted into carries the region the camera addresses.
    expect(element.closest(`[${REGION_ATTR}]`)?.getAttribute(REGION_ATTR)).toBe(
      "overlay.dialog:jxsuite-update",
    );

    element.dispatchEvent(new Event("cancel"));
    await p;
  });

  test("confirm pins each package to its OWN latest", async () => {
    let received: unknown;
    withRegistry(
      [
        { current: "^1.2.0", dev: true, latest: "1.4.0", name: "@jxsuite/parser" },
        { current: "^2.0.1", latest: "2.3.0", name: "@jxsuite/runtime" },
      ],
      {
        setPackageVersions: async (u) => {
          received = u;
          return { ok: true };
        },
      },
    );
    const p = maybePromptJxsuiteUpdate("/project");
    const element = await openedDialog();
    element.dispatchEvent(new Event("confirm"));
    await p;
    await flush();
    expect(received).toEqual([
      { dev: true, name: "@jxsuite/parser", version: "^1.4.0" },
      { dev: false, name: "@jxsuite/runtime", version: "^2.3.0" },
    ]);
    // The document went with the answer: the layer is empty again.
    expect(dialog()).toBeNull();
  });

  test("cancel is remembered against the exact versions declined", async () => {
    withRegistry([{ current: "^1.2.0", latest: "1.4.0", name: "@jxsuite/parser" }], {
      setPackageVersions: async () => ({ ok: true }),
    });
    const p = maybePromptJxsuiteUpdate("/project");
    const element = await openedDialog();
    element.dispatchEvent(new Event("cancel"));
    await p;
    expect(localStorage.getItem("jx:jxsuite-update-dismissed:/project:@jxsuite/parser@1.4.0")).toBe(
      "1",
    );
    expect(dialog()).toBeNull();

    await maybePromptJxsuiteUpdate("/project");
    await flush();
    expect(dialog()).toBeNull();
  });

  test("the platform's own close declines, whatever closed it", async () => {
    /*
     * Escape, or a dismissal the platform owns: the dialog reports `close` and nothing else. It
     * must count as "not now" — the alternative is a promise nobody resolves and a project open
     * that never finishes.
     */
    withRegistry([{ current: "^1.2.0", latest: "1.4.0", name: "@jxsuite/parser" }], {
      setPackageVersions: async () => {
        throw new Error("the install must not run");
      },
    });
    const p = maybePromptJxsuiteUpdate("/project-closed");
    const element = await openedDialog();
    element.dispatchEvent(new Event("close"));
    await p;
    expect(
      localStorage.getItem("jx:jxsuite-update-dismissed:/project-closed:@jxsuite/parser@1.4.0"),
    ).toBe("1");
  });

  test("a NEWER publish asks again, rather than staying dismissed forever", async () => {
    /* The reason the key is the version set and not the project. Declining 1.4.0 says nothing about
       1.5.0, and under the old single-target key a decline could outlive several releases. */
    withRegistry([{ current: "^1.2.0", latest: "1.4.0", name: "@jxsuite/parser" }], {
      setPackageVersions: async () => ({ ok: true }),
    });
    const first = maybePromptJxsuiteUpdate("/project");
    const declined = await openedDialog();
    declined.dispatchEvent(new Event("cancel"));
    await first;

    withRegistry([{ current: "^1.2.0", latest: "1.5.0", name: "@jxsuite/parser" }], {
      setPackageVersions: async () => ({ ok: true }),
    });
    const second = maybePromptJxsuiteUpdate("/project");
    const element = await openedDialog();
    expect(rows(element)).toEqual({ "@jxsuite/parser": "^1.2.0 → ^1.5.0" });
    element.dispatchEvent(new Event("cancel"));
    await second;
  });

  test("no-op when the platform cannot set versions", async () => {
    withRegistry([{ current: "^1.2.0", latest: "1.4.0", name: "@jxsuite/parser" }]);
    await maybePromptJxsuiteUpdate("/project");
    await flush();
    expect(dialog()).toBeNull();
  });
});

describe("applyJxsuiteUpdate", () => {
  test("surfaces the failure log as a Problem when the bump fails", async () => {
    installMockPlatform({
      setPackageVersions: async () => ({ log: "version conflict", ok: false }),
    });
    await applyJxsuiteUpdate([
      { current: "^1.2.0", dev: false, latest: "1.4.0", name: "@jxsuite/parser" },
    ]);
    await flush();
    expect(problems[0]?.message).toContain("version conflict");
  });

  test("an empty list installs nothing and opens no modal", async () => {
    let called = false;
    installMockPlatform({
      setPackageVersions: async () => {
        called = true;
        return { ok: true };
      },
    });
    await applyJxsuiteUpdate([]);
    expect(called).toBe(false);
  });
});

describe("the offer surface on its own", () => {
  test("closing before the mount lands disposes it, and a second close says nothing twice", async () => {
    /*
     * The flow never reaches this: it opens the offer and waits for an answer. But the mount is
     * asynchronous, so a caller CAN take the dialog down before the document has landed — and the
     * mount that arrives afterwards must be disposed rather than left showing over an app that has
     * moved on. `onClosed` fires once, because two paths reach it and either may be first.
     */
    const { openJxsuiteUpdateSurface } = await import("../src/surfaces/jxsuite-update");
    const layer = document.createElement("div");
    document.body.append(layer);
    let closures = 0;
    const handle = openJxsuiteUpdateSurface({
      layer,
      onCancel: () => {},
      onClosed: () => {
        closures += 1;
      },
      onConfirm: () => {},
      packages: [{ current: "^1.0.0", name: "@jxsuite/runtime", target: "^1.1.0" }],
    });
    expect(layer.childElementCount).toBe(1);

    handle.close();
    expect(layer.childElementCount).toBe(0);
    handle.close();
    expect(closures).toBe(1);

    const element = await handle.ready;
    await flush();
    expect(element.isConnected).toBe(false);
    layer.remove();
  });
});
