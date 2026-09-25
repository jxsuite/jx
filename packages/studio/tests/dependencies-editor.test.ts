/**
 * Tests for the Packages settings section — `src/settings/dependencies-editor.ts`, the flow, and
 * `src/surfaces/settings-packages.json`, the document it mounts.
 *
 * The Latest column is the registry's answer for EVERY row. The `../src/version` mock below is
 * deliberately a version no package in these fixtures is at: it is what the `@jxsuite/*` rows used
 * to be pinned to, so a row showing it again is the regression these tests exist to catch.
 *
 * Everything is addressed by `part`, because the section is a document: there is no `sp-table-row`,
 * `sp-table-cell` or `.settings-muted` to find any more. A row is a `<tr>` carrying the package it
 * draws, and the two buttons on it are named after that package rather than after the verb, so the
 * queries below say which row they act on.
 */
import { flush, installMockPlatform, pointer } from "./harness";
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import type { PackageInfo } from "../src/types";

void mock.module("../src/version", () => ({
  APP_NAME: "Jx Studio",
  BUILD_DATE: "",
  GIT_COMMIT: "test",
  LINKS: { docs: "", github: "", license: "" },
  VERSION: "0.30.1",
}));

const { renderDependenciesEditor } = await import("../src/settings/dependencies-editor");

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

function makeContainer(): HTMLElement {
  const c = document.createElement("div");
  document.body.append(c);
  return c;
}

afterEach(() => {
  for (const d of document.querySelectorAll("body > div")) {
    if (!d.id) {
      d.remove();
    }
  }
  (document.querySelector("#layer-modal") as HTMLElement).innerHTML = "";
});

const TWO_DEPS = {
  listPackages: async () => [
    { dev: true, name: "@jxsuite/compiler", version: "^0.19.0" },
    { name: "hono", version: "^4.0.0" },
  ],
  packageVersions: async () => [
    { current: "^0.19.0", dev: true, latest: "0.22.0", name: "@jxsuite/compiler" },
    { current: "^4.0.0", latest: "4.6.0", name: "hono" },
  ],
};

/** Draw the section into a fresh container and let the surface mount. */
async function setup(overrides: Record<string, unknown>): Promise<HTMLElement> {
  installMockPlatform(overrides);
  const c = makeContainer();
  renderDependenciesEditor(c);
  await flush(4);
  return c;
}

/** The line drawn where the table would be: "Loading…" or "No dependencies.". */
function status(c: HTMLElement): string {
  return c.querySelector('[part="status"]')?.textContent?.trim() ?? "";
}

/** One package's row, found by the package it draws. */
function row(c: HTMLElement, name: string): HTMLElement | null {
  return c.querySelector(`[part="row"][data-package="${name}"]`);
}

/** A cell of one package's row, by the column it is in. */
function cell(c: HTMLElement, name: string, part: string): string | undefined {
  return row(c, name)?.querySelector(`[part="${part}"]`)?.textContent?.trim();
}

/** Every package the table lists, in order. */
function listed(c: HTMLElement): (string | undefined)[] {
  return [...c.querySelectorAll('[part="row"]')].map((r) => (r as HTMLElement).dataset["package"]);
}

describe("renderDependenciesEditor", () => {
  test("shows a loading state until the list comes back", async () => {
    let release: (list: PackageInfo[]) => void = () => {};
    const pending = new Promise<PackageInfo[]>((resolve) => {
      release = resolve;
    });
    const c = await setup({ listPackages: () => pending });
    /* The list has not come back. "Loading…" is not the empty state: a table drawn now would say
       "No dependencies." about a project nobody has finished asking about. */
    expect(status(c)).toContain("Loading");

    release([{ name: "hono", version: "^4.0.0" }]);
    await flush(4);
    expect(status(c)).toBe("");
    expect(cell(c, "hono", "current")).toBe("^4.0.0");
  });

  test("the table lists every dependency with its current and latest version", async () => {
    const c = await setup(TWO_DEPS);
    expect(listed(c)).toEqual(["@jxsuite/compiler", "hono"]);
    expect(cell(c, "@jxsuite/compiler", "latest")).toBe("0.22.0");
    expect(cell(c, "hono", "latest")).toBe("4.6.0");
    // A devDependency says so beside its name rather than in a column of its own.
    expect(cell(c, "@jxsuite/compiler", "dev")).toBe("· dev");
    expect(row(c, "hono")?.querySelector('[part="dev"]')).toBeNull();
  });

  test("a package already AT its latest shows that version, with no update button", async () => {
    /*
     * The reported defect. The backend was asked for OUTDATED packages, so a current dependency
     * arrived as an absence and the Latest column read `—` — the registry's answer was known and
     * discarded. It is a version now, and only the update affordance is conditional.
     */
    const c = await setup({
      listPackages: async () => [{ name: "hono", version: "^4.6.0" }],
      packageVersions: async () => [{ current: "^4.6.0", latest: "4.6.0", name: "hono" }],
    });
    expect(cell(c, "hono", "latest")).toBe("4.6.0");
    expect(c.querySelector('[part="update"]')).toBeNull();
    expect(c.querySelector('[part="update-all"]')).toBeNull();
  });

  test("a package pinned AHEAD of the registry shows latest but is not offered a downgrade", async () => {
    const c = await setup({
      listPackages: async () => [{ name: "hono", version: "^5.0.0-rc.1" }],
      packageVersions: async () => [{ current: "^5.0.0-rc.1", latest: "4.6.0", name: "hono" }],
    });
    expect(cell(c, "hono", "latest")).toBe("4.6.0");
    expect(c.querySelector('[part="update"]')).toBeNull();
  });

  test("a package the registry cannot answer for reads —", async () => {
    // A workspace:/file:/git spec, or a name npm does not serve: no row comes back for it at all.
    const c = await setup({
      listPackages: async () => [{ name: "local-thing", version: "workspace:^" }],
      packageVersions: async () => [],
    });
    expect(cell(c, "local-thing", "latest")).toBe("—");
  });

  test("renders the empty state when there are no dependencies", async () => {
    const c = await setup({ listPackages: async () => [] });
    expect(status(c)).toContain("No dependencies");
    expect(c.querySelector('[part="table"]')).toBeNull();
  });

  test("update sends a ^latest bump for the row", async () => {
    let received: unknown;
    const c = await setup({
      ...TWO_DEPS,
      setPackageVersions: async (u: unknown) => {
        received = u;
        return { ok: true };
      },
    });
    /* The button is named after the package and the version it would install: there is one of it
       per row, and "Update" alone would be the same name as many times over. The name is read off
       the control the reader reaches rather than off the host, because that is the one a screen
       reader announces. */
    expect(
      row(c, "hono")?.querySelector('[part="update"] [part="control"]')?.getAttribute("aria-label"),
    ).toBe("Update hono to 4.6.0");
    pointer(row(c, "hono")!.querySelector('[part="update"]')!, "click");
    await flush(4);
    expect(received).toEqual([{ dev: false, name: "hono", version: "^4.6.0" }]);
  });

  test("update all bumps every dependency that is actually behind", async () => {
    let received: { name: string }[] = [];
    const c = await setup({
      ...TWO_DEPS,
      setPackageVersions: async (u: { name: string }[]) => {
        received = u;
        return { ok: true };
      },
    });
    pointer(c.querySelector('[part="update-all"]')!, "click");
    await flush(4);
    expect(received.map((u) => u.name).toSorted()).toEqual(["@jxsuite/compiler", "hono"]);
  });

  test("remove calls removePackage", async () => {
    let removed: string | undefined;
    const c = await setup({
      ...TWO_DEPS,
      removePackage: async (name: string) => {
        removed = name;
        return {};
      },
    });
    pointer(row(c, "@jxsuite/compiler")!.querySelector('[part="remove"]')!, "click");
    await flush(4);
    expect(removed).toBe("@jxsuite/compiler");
  });

  test("add installs the typed package name and empties the field", async () => {
    let added: string | undefined;
    const c = await setup({
      listPackages: async () => [],
      addPackage: async (name: string) => {
        added = name;
        return {};
      },
    });
    const field = c.querySelector('[part="add-field"] [part="input"]') as HTMLInputElement;
    field.value = "lodash";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(2);
    pointer(c.querySelector('[part="add-button"]')!, "click");
    await flush(4);
    expect(added).toBe("lodash");
    /*
     * The echo, asserted rather than assumed. The section clears `_addName` after the install and
     * redraws; that write only reaches the field because the keystroke was stated to the scope
     * first — a scope that had never moved off "" would be written "" again, which is not a change,
     * and the installed package's name would still be sitting in the field.
     */
    expect(field.value).toBe("");
  });

  test("reinstall runs installDependencies", async () => {
    let reinstalled = 0;
    const c = await setup({
      ...TWO_DEPS,
      installDependencies: async () => {
        reinstalled += 1;
        return { ok: true };
      },
    });
    pointer(c.querySelector('[part="reinstall"]')!, "click");
    await flush(4);
    expect(reinstalled).toBe(1);
  });
});
