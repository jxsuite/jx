/**
 * The three verbs over `project.json` `extensions[]`.
 *
 * Two properties carry the file. First, §12.4's rule that a family over one piece of state declares
 * ONE availability rule — asserted over a context matrix rather than by reading three records and
 * hoping. Second, that every argument-dependent refusal NAMES the value and says what to do, which
 * is what makes the same refusal readable to a person in the palette and to the agent in a tool
 * result. Since `registry.run` coerces `package` against each record's derived enum, the first
 * refusal a caller meets is the schema's own, and these tests assert that sentence.
 */
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import {
  enableExtension,
  extensionCommands,
  extensionOpInFlight,
} from "../src/settings/extension-commands";
import { refreshFormats, setExtensionCatalog, setExtensions } from "../src/format/format-host";
import type { CommandContext } from "../src/commands/context";
import type { ExtensionCatalogEntry } from "../src/types";

const IDS = ["project.enableExtension", "project.disableExtension", "packages.remove"] as const;

const PARSER: ExtensionCatalogEntry = {
  installed: false,
  name: "@jxsuite/parser",
  sections: [{ key: "content" }],
  source: "first-party",
  title: "Content & Markdown",
};

function registryWith(open: boolean) {
  const base = emptyContext();
  const context = (): CommandContext => ({ ...base, project: { ...base.project, open } });
  const registry = createCommandRegistry({ getContext: context });
  registry.registerAll(extensionCommands());
  return registry;
}

beforeEach(() => {
  resetWorkspaceWithTab();
  refreshFormats();
  installMockPlatform();
  setExtensionCatalog([PARSER]);
  setExtensions([]);
});

afterEach(() => {
  refreshFormats();
});

describe("one availability rule across the family (§12.4)", () => {
  test("all three agree in every context", () => {
    /*
     * The disagreement §12.4 catalogues is always the same shape: the loose member is the one that
     * writes. All three of these write, so a matrix is the honest test — reading the records and
     * eyeballing them is what let six other families drift.
     */
    for (const open of [true, false]) {
      const registry = registryWith(open);
      const answers = IDS.map((id) => registry.isEnabled(id));
      expect(new Set(answers).size).toBe(1);
      expect(answers[0]).toBe(open);
    }
  });

  test("each refuses with the same sentence a disabled control would print", () => {
    const registry = registryWith(false);
    for (const id of IDS) {
      expect(registry.disabledReason(id)).toBe("an open project");
      expect(registry.refusalMessage(id)).toContain("requires an open project");
    }
  });

  test("every record registers cleanly and is palette-placed", () => {
    const registry = registryWith(true);
    for (const id of IDS) {
      expect(registry.get(id)?.menus).toEqual(["palette"]);
      // A verb that is useless without an argument does not earn chrome, and a chord for
      // "enable WHICH extension?" would be meaningless.
      expect(registry.get(id)?.keybinding).toBeUndefined();
    }
  });

  test("the undo scopes tell the truth about what can be taken back", () => {
    const registry = registryWith(true);
    // Enabling installs, and an install is not a transaction — claiming `project` would promise a
    // ⌘Z that leaves the package on disk.
    expect(registry.get("project.enableExtension")?.undo).toBe("none");
    // Disabling is a pure project.json transaction.
    expect(registry.get("project.disableExtension")?.undo).toBe("project");
    expect(registry.get("packages.remove")?.undo).toBe("none");
  });

  test("only the two verbs the agent can judge carry an aiTool", () => {
    const registry = registryWith(true);
    expect(registry.get("project.enableExtension")?.aiTool?.name).toBe("enable_extension");
    expect(registry.get("project.disableExtension")?.aiTool?.name).toBe("disable_extension");
    // The model has no read that tells it whether a dependency is load-bearing elsewhere, and the
    // Act is destructive and not undoable.
    expect(registry.get("packages.remove")?.aiTool).toBeUndefined();
    expect(registry.get("packages.remove")?.destructive).toBe(true);
  });
});

describe("argument refusals name the value (§12.4)", () => {
  /*
   * The two refusals below are the SCHEMA's, not `enableExtension`'s. `registry.run` coerces
   * `package` against the derived enum before `run` is entered, so a value the choice list would
   * never have offered — an unknown package, one this backend cannot run — reads the same sentence
   * every other enum argument does, synchronously, and the model and `__jxAutomation` read exactly
   * what the palette's choice list implied. `enableExtension`'s richer sentences remain for the
   * Extensions section's direct call and for a row that changed between rounds.
   */
  test("an unknown package is refused, and the message lists what is offered", () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    const registry = registryWith(true);
    expect(() => registry.run("project.enableExtension", { package: "@acme/nope" })).toThrow(
      'command "project.enableExtension" argument "package": "@acme/nope" is not declared — ' +
        "declared: @jxsuite/parser",
    );
  });

  test("an extension this backend cannot run is outside the enum, so it is refused as undeclared", () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    setExtensionCatalog([{ ...PARSER, problem: "this Worker bundles no parser" }]);
    const registry = registryWith(true);
    expect(() => registry.run("project.enableExtension", { package: "@jxsuite/parser" })).toThrow(
      'command "project.enableExtension" argument "package": "@jxsuite/parser" is not declared — ' +
        "declared: none",
    );
  });

  test("the backend's own sentence still reaches a caller that bypasses the schema", async () => {
    // The Extensions section calls `enableExtension` directly, and a row can become unavailable
    // Between the schema being read and the verb running; both read the richer sentence.
    resetStudioState({ projectConfig: { extensions: [] } });
    setExtensionCatalog([{ ...PARSER, problem: "this Worker bundles no parser" }]);
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(enableExtension("@jxsuite/parser")).rejects.toThrow(
      /this Worker bundles no parser/,
    );
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(enableExtension("@acme/nope")).rejects.toThrow(
      /"@acme\/nope" is not an extension this backend offers/,
    );
  });

  test("removing a package that is still enabled is refused, and says to disable it first", async () => {
    resetStudioState({ projectConfig: { extensions: ["@jxsuite/parser"] } });
    const registry = registryWith(true);
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(registry.run("packages.remove", { package: "@jxsuite/parser" })).rejects.toThrow(
      /still enabled in project\.json "extensions" — disable it first/,
    );
  });
});

describe("enable is idempotent; disable refuses what is not on", () => {
  test("enabling an already-enabled extension writes nothing", async () => {
    // The enable enum names every row this backend offers, enabled or not, so an enabled package
    // Is a declared value and `enableExtension`'s own early return keeps the verb idempotent.
    resetStudioState({ projectConfig: { extensions: ["@jxsuite/parser"] } });
    const { state } = installMockPlatform();
    const registry = registryWith(true);
    await registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    expect(state.calls.some(([name]) => name === "addPackage")).toBe(false);
    expect(state.calls.some(([name]) => name === "writeFile")).toBe(false);
  });

  test("the enable enum lists what is already on, which is what keeps that true", () => {
    resetStudioState({ projectConfig: { extensions: ["@jxsuite/parser"] } });
    const registry = registryWith(true);
    const schema = registry.get("project.enableExtension")?.args as {
      properties: { package: { enum: string[] } };
    };
    expect(schema.properties.package.enum).toEqual(["@jxsuite/parser"]);
  });

  test("disabling an extension the project does not have is refused as undeclared", () => {
    /* It used to be a silent no-op. The disable enum is `enabledSpecifiers()` — the palette only
       ever offered what was on — and `registry.run` now coerces against it, so the sentence the
       palette implied by omission is the one every caller reads. Nothing is written. */
    resetStudioState({ projectConfig: { extensions: ["@acme/on"] } });
    const { state } = installMockPlatform();
    const registry = registryWith(true);
    expect(() => registry.run("project.disableExtension", { package: "@jxsuite/parser" })).toThrow(
      'command "project.disableExtension" argument "package": "@jxsuite/parser" is not declared — ' +
        "declared: @acme/on",
    );
    expect(state.calls.some(([name]) => name === "writeFile")).toBe(false);
  });
});

describe("the choice lists are derived, not snapshotted", () => {
  test("enable offers nothing before a project and the catalogue after it", () => {
    /*
     * `derivedEnumProperty`, not `enumProperty`. The records are built at module scope in
     * app-commands.ts, before any project is open, so a snapshot would freeze both lists at [] for
     * the life of the window and the palette would offer an empty choice forever.
     */
    setExtensionCatalog([]);
    resetStudioState({ projectConfig: {} });
    const registry = registryWith(true);
    const schema = registry.get("project.enableExtension")?.args as {
      properties: { package: { enum: string[] } };
    };
    expect(schema.properties.package.enum).toEqual([]);

    setExtensionCatalog([PARSER]);
    expect(schema.properties.package.enum).toEqual(["@jxsuite/parser"]);
  });

  test("disable offers exactly what project.json names", () => {
    resetStudioState({ projectConfig: { extensions: ["@acme/one", "@acme/two"] } });
    const registry = registryWith(true);
    const schema = registry.get("project.disableExtension")?.args as {
      properties: { package: { enum: string[] } };
    };
    expect(schema.properties.package.enum).toEqual(["@acme/one", "@acme/two"]);
  });
});

describe("one operation at a time", () => {
  test("the latch is clear when nothing is running", () => {
    expect(extensionOpInFlight()).toBeNull();
  });

  test("enabling is refused while another operation runs", async () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    let release: (() => void) | undefined;
    installMockPlatform({
      addPackage: () =>
        new Promise<void>((r) => {
          release = r;
        }) as Promise<unknown>,
    });
    setExtensionCatalog([PARSER, { ...PARSER, name: "@jxsuite/feed", title: "Feeds" }]);
    const registry = registryWith(true);
    const first = registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(
      registry.run("project.enableExtension", { package: "@jxsuite/feed" }),
    ).rejects.toThrow(/Another extension operation is running/);
    release?.();
    await first;
  });

  test("removing a package is refused while another operation runs", async () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    let release: (() => void) | undefined;
    installMockPlatform({
      addPackage: () =>
        new Promise<void>((r) => {
          release = r;
        }) as Promise<unknown>,
    });
    const registry = registryWith(true);
    const first = registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(registry.run("packages.remove", { package: "@acme/other" })).rejects.toThrow(
      /Another extension operation is running/,
    );
    release?.();
    await first;
  });

  test("removing a package that is not enabled uninstalls it and reports it", async () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    const { state } = installMockPlatform();
    const registry = registryWith(true);
    await registry.run("packages.remove", { package: "@acme/gone" });
    expect(
      state.calls.some(([name, arg]) => name === "removePackage" && arg === "@acme/gone"),
    ).toBe(true);
  });

  test("a second operation is refused while the first is in flight", async () => {
    // `@acme/on` is enabled so that disabling it is a DECLARED value: the schema is coerced before
    // The latch is consulted, and a package the project does not have would be refused there.
    resetStudioState({ projectConfig: { extensions: ["@acme/on"] } });
    let release: (() => void) | undefined;
    installMockPlatform({
      addPackage: () =>
        new Promise<void>((r) => {
          release = r;
        }) as Promise<unknown>,
    });
    const registry = registryWith(true);
    const first = registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    // The latch is taken synchronously, before the first await — which is what lets the section
    // Repaint every other switch as disabled.
    expect(extensionOpInFlight()).toBe("@jxsuite/parser");
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(registry.run("project.disableExtension", { package: "@acme/on" })).rejects.toThrow(
      /Another extension operation is running \(@jxsuite\/parser\)/,
    );
    release?.();
    await first;
    expect(extensionOpInFlight()).toBeNull();
  });
});

describe("what the assistant is told afterwards (aiTool.report)", () => {
  /*
   * The two verbs ARE the assistant's `enable_extension` / `disable_extension` — a declaration
   * makes a tool (`services/ai-command-tools.ts`) — and what the record cannot say for itself is
   * what to tell the model afterwards. These sentences used to live in a hand-registered tool
   * beside the records; they are the records' own now, read through the same `buildRows()` the
   * Extensions section reads.
   */
  const facts = (name: string) => ({
    after: emptyContext(),
    args: { package: name } as never,
    before: emptyContext(),
  });

  test("enable names the sections the extension made valid and the enabled set", async () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    // The config commit re-reads the catalogue from the platform; the report reads what it left.
    installMockPlatform({ listExtensionCatalog: async () => [PARSER] });
    const registry = registryWith(true);
    await registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    const report = registry
      .get("project.enableExtension")!
      .aiTool!.report(facts("@jxsuite/parser"));
    expect(report).toEqual({
      summary:
        "Enabled @jxsuite/parser. Its project.json sections are now valid: content. Enabled " +
        "extensions: @jxsuite/parser.",
      // `undo: "none"` cannot default a ledger path, so the report names what it wrote — and
      // `package.json` only for a run that installed, which the mock platform's addPackage did.
      wrote: ["project.json", "package.json"],
    });
  });

  test("an enable that only wrote project.json says so in its ledger paths", async () => {
    setExtensionCatalog([{ ...PARSER, installed: true }]);
    resetStudioState({ projectConfig: { extensions: [] } });
    const { state } = installMockPlatform({
      listExtensionCatalog: async () => [{ ...PARSER, installed: true }],
    });
    const registry = registryWith(true);
    await registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    expect(state.calls.some(([name]) => name === "addPackage")).toBe(false);
    const report = registry
      .get("project.enableExtension")!
      .aiTool!.report(facts("@jxsuite/parser"));
    expect(typeof report === "string" ? undefined : report.wrote).toEqual(["project.json"]);
  });

  test("an extension with no sections still reports the enabled set", async () => {
    const bare = { ...PARSER, installed: true, sections: [] };
    setExtensionCatalog([bare]);
    resetStudioState({ projectConfig: { extensions: [] } });
    installMockPlatform({ listExtensionCatalog: async () => [bare] });
    const registry = registryWith(true);
    // The run is what the report describes: read without one, the sentence is the last run's.
    await registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    const report = registry
      .get("project.enableExtension")!
      .aiTool!.report(facts("@jxsuite/parser"));
    expect(typeof report === "string" ? report : report.summary).toBe(
      "Enabled @jxsuite/parser. Enabled extensions: @jxsuite/parser.",
    );
  });

  test("enabling what is already on is a statement with no ledger paths, not a phantom write", async () => {
    /* `enableExtension` returns before writing when the row is already enabled (its enum offers
       enabled rows on purpose, see above). The report has to say THAT: "Enabled X" with
       `project.json` in `wrote` would file a "Changed 1 file — undo cannot reach it" entry for a
       run that touched nothing, which is the phantom-write shape the ledger exists to keep out.
       `wrote: []` is how a record says "this run changed nothing" and the bridge files none. */
    resetStudioState({ projectConfig: { extensions: ["@jxsuite/parser"] } });
    const { state } = installMockPlatform();
    const registry = registryWith(true);
    await registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    expect(state.calls.some(([name]) => name === "writeFile")).toBe(false);
    const report = registry
      .get("project.enableExtension")!
      .aiTool!.report(facts("@jxsuite/parser"));
    expect(report).toEqual({
      summary:
        "@jxsuite/parser was already enabled. Its project.json sections are valid: content. " +
        "Enabled extensions: @jxsuite/parser.",
      wrote: [],
    });
  });

  test("the no-op's empty ledger is per run: it does not inherit the install before it", async () => {
    // Install-then-enable, then enable again: the second report must not repeat `package.json`.
    resetStudioState({ projectConfig: { extensions: [] } });
    installMockPlatform({ listExtensionCatalog: async () => [PARSER] });
    const registry = registryWith(true);
    await registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    await registry.run("project.enableExtension", { package: "@jxsuite/parser" });
    const report = registry
      .get("project.enableExtension")!
      .aiTool!.report(facts("@jxsuite/parser"));
    expect(typeof report === "string" ? undefined : report.wrote).toEqual([]);
  });

  test("disable says the package is still installed, and to ask before uninstalling", () => {
    resetStudioState({ projectConfig: { extensions: [] } });
    const registry = registryWith(true);
    const report = registry
      .get("project.disableExtension")!
      .aiTool!.report(facts("@jxsuite/parser"));
    expect(report).toBe(
      "Disabled @jxsuite/parser; its npm package is still installed. Ask before uninstalling it. " +
        "Enabled extensions: none.",
    );
  });
});
