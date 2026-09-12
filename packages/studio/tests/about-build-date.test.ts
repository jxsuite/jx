/**
 * The About dialog's "Build date" row — `formatBuildDate` in `src/about/about-modal.ts`.
 *
 * `about-modal.test.ts` only ever sees the fallback: under `bun test` the build-time define is
 * absent, `BUILD_DATE` is `""`, and the row reads `—`. The two branches a REAL bundle takes — an
 * ISO stamp `scripts/build.ts` wrote, formatted for the reader; a stamp `Date` cannot parse, shown
 * as it came — need a `BUILD_DATE` of their own, so this file doubles `src/version.ts` and re-mocks
 * it per test. Bun's module mocks are live bindings: the surface reads the new value on its next
 * open without being imported again.
 */
import { flush, installMockPlatform } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { initLayers } from "../src/ui/layers";

/** The double, with only the field under test varying — everything else is inert here. */
function mockVersion(buildDate: string): void {
  void mock.module("../src/version", () => ({
    APP_NAME: "Jx Studio",
    BUILD_DATE: buildDate,
    GIT_COMMIT: "test",
    LINKS: { docs: "https://example.test/docs", github: "https://example.test", license: "" },
    VERSION: "0.30.1",
  }));
}

mockVersion("");
const { openAboutModal } = await import("../src/about/about-modal");

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

function modal(): HTMLElement | null {
  return document.querySelector('#layer-dialog jx-dialog[part="about"]');
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
  installMockPlatform({ listPackages: async () => [] });
});

afterEach(async () => {
  // The dialog dismisses itself, so tear it down the way a reader would: the platform's `cancel`.
  modal()?.dispatchEvent(new Event("cancel", { bubbles: true }));
  await flush();
});

describe("the Build date row", () => {
  test("formats a parseable ISO stamp for the reader rather than echoing it", async () => {
    /* Compared against the same call in the same process, because `toLocaleString()` is the
       runner's locale and zone — and against the raw stamp, so a branch that echoed it would fail
       on the second line even if the first happened to agree. */
    const iso = "2026-03-04T05:06:07.000Z";
    mockVersion(iso);
    await open();
    const shown = metaRow("Build date");
    expect(shown).toBe(new Date(iso).toLocaleString());
    expect(shown).not.toBe(iso);
    expect(shown).not.toBe("—");
  });

  test("shows an unparseable stamp verbatim — a wrong stamp is still worth reporting", async () => {
    /* The alternative is `Invalid Date`, which tells a reader nothing about what the build wrote.
       The stamp itself at least names what went wrong. */
    mockVersion("not-a-date");
    await open();
    expect(metaRow("Build date")).toBe("not-a-date");
  });

  test("an empty stamp is the dash, not an empty cell or Invalid Date", async () => {
    /* The guard the other two branches sit behind: `new Date("")` is also unparseable, so without
       it the empty stamp would print itself — as nothing — and read as a missing row. Asserted
       here too so all three outcomes are proven against one double. */
    mockVersion("");
    await open();
    expect(metaRow("Build date")).toBe("—");
  });
});
