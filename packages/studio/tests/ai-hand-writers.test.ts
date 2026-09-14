/**
 * The closed table of hand-registered assistant tools that WRITE (issue 273, invariant ii).
 *
 * A tool that writes what a command writes must go through `registry.run`, so the person's gate and
 * the agent's are one predicate — that is what `services/ai-command-tools.ts` makes true for every
 * command record that declares `aiTool`. What the type system cannot say is that no OTHER tool
 * reaches for a mutator or a platform write on its own. So this table says it: every
 * `src/services/ai-*.ts` that imports a mutator from `../tabs/transact`, calls the platform's
 * `writeFile` / `createProject` / `importSite`, or calls `adoptProjectConfig`, must be listed here
 * with the reason no command owns its write — and every listed file must still exist and still
 * match, in the `UNCALLED` idiom of `app-commands-composition.test.ts`, so the table can only be
 * edited on purpose.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SERVICES = resolve(import.meta.dir, "..", "src", "services");

/**
 * The hand writers, and why no command owns each write.
 *
 * Adding a row here is a design decision: it says a tool writes something no person-verb writes.
 * Removing one is the ordinary direction — the tool became a command projection.
 */
const HAND_WRITERS = new Map<string, string>([
  [
    "ai-tools.ts",
    "set_property, set_style, set_text, add_child, move_node, add_state and update_state address " +
      "a node by PATH; the person writes these through the Inspector, which is not a command " +
      "surface. Gated by the document-tree tier, which reads editor.kind from the registry's " +
      "context. create_page and create_component write a new file through the injected saveFile " +
      "and have no command twin: the person's door is the Files tree's New File prompt, which " +
      "waits on a name.",
  ],
  [
    "ai-project-tools.ts",
    "write_file and create_project write files, not command state; studio.md §13.5's Remote " +
      "Rule makes a file.write command an automation surface that bypasses the transaction log " +
      "by design, and create_project re-keys the conversation as a side effect no command may " +
      "know about.",
  ],
  [
    "ai-import-tools.ts",
    "import_site is the platform's importSite pipeline; project.new only opens the wizard that " +
      "hosts it.",
  ],
]);

/** The shapes that make a module a writer. Each is a regex over its source text. */
const WRITER_SHAPES: readonly [string, RegExp][] = [
  [
    "a transact mutator import",
    /import\s*\{[^}]*\b(?:transactDoc|mutate[A-Z]\w*)\b[^}]*\}\s*from\s*"\.\.\/tabs\/transact"/,
  ],
  ["a platform write", /\.(?:writeFile|createProject|importSite)\(/],
  ["adoptProjectConfig", /\badoptProjectConfig\(/],
];

function writerShapesOf(text: string): string[] {
  return WRITER_SHAPES.filter(([, shape]) => shape.test(text)).map(([label]) => label);
}

function aiServiceFiles(): string[] {
  return readdirSync(SERVICES)
    .filter((name) => name.startsWith("ai-") && name.endsWith(".ts"))
    .toSorted();
}

describe("the hand-writers table", () => {
  test("every ai-*.ts that writes is in the table with its reason, and nothing else is", () => {
    const writers: string[] = [];
    for (const name of aiServiceFiles()) {
      const text = readFileSync(join(SERVICES, name), "utf8");
      const shapes = writerShapesOf(text);
      if (shapes.length > 0) {
        writers.push(name);
      }
      expect([name, shapes, HAND_WRITERS.has(name)]).toEqual([name, shapes, shapes.length > 0]);
    }
    // The table only ratchets: a row for a file that no longer writes is a stale reason.
    expect(writers.toSorted()).toEqual([...HAND_WRITERS.keys()].toSorted());
  });

  test("every listed file still exists and still carries a reason", () => {
    const files = new Set(aiServiceFiles());
    for (const [name, reason] of HAND_WRITERS) {
      expect([name, files.has(name)]).toEqual([name, true]);
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  test("the bridge itself imports no writer: its only write is registry.run", () => {
    const text = readFileSync(join(SERVICES, "ai-command-tools.ts"), "utf8");
    expect(writerShapesOf(text)).toEqual([]);
    expect(text).not.toContain("mutateRemoveNode");
    // The one door to a write it holds is the registry's.
    expect(text).toContain("registry.run(");
  });

  test("ai-tools.ts no longer opens a document of its own", () => {
    // `open_document` became the projection of `document.open` (#334); the hand tool that read
    // `getTab()` after the open and called whatever it found a success must not come back.
    const text = readFileSync(join(SERVICES, "ai-tools.ts"), "utf8");
    expect(text).not.toContain('name: "open_document"');
    expect(text).not.toContain("openDocument");
  });

  test("ai-tools.ts no longer carries a deletion of its own", () => {
    // `remove_node` guarded only the document root, a weaker test than `structurallyEditable`; its
    // Replacement is `delete_node`, the projection of `selection.delete`, so the mutator it used
    // Must not come back here under another name.
    const text = readFileSync(join(SERVICES, "ai-tools.ts"), "utf8");
    expect(text).not.toContain("mutateRemoveNode");
    expect(text).not.toContain('name: "remove_node"');
  });
});
