/**
 * An element or an icon that reaches no DOM, in each of the two ways this codebase can produce one.
 *
 * There are TWO key spaces here and they fail differently. Conflating them is not a hypothetical
 * mistake: the first version of this checker made it, passed, and certified a rail button that
 * renders a 20px hole.
 *
 * 1. **A tag written in a document** — `<jx-icon>`, `<jx-menu-item>` — resolves through
 *    `customElements`. An element the browser has never heard of is an `HTMLUnknownElement`: no
 *    shadow root, no content and no warning. The type checker is silent (the tag is a string in a
 *    document), the linter is silent, and happy-dom is as content to render nothing as Chrome is,
 *    so a test asserting `querySelector("jx-thing")` is not null PASSES while the element draws
 *    nothing. Eleven shipped that way when the tags were Spectrum's. Three named elements the
 *    library had no such thing as.
 * 2. **A key on a record** — `icon: "folder"` — resolves through the UI KIT'S MANIFEST, and never
 *    reaches `customElements` at all. `PanelRecord.icon` is drawn by the rail surface through
 *    `jx-icon`, whose manifest is `@jxsuite/ui`'s: a name absent from it draws nothing above the
 *    label and warns once in the console, which a screenshot does not show and a test that only
 *    asks whether the button exists does not see. Three rail buttons once shipped that way, when
 *    the keys resolved through a hand-kept map in the rail module.
 *
 * So: tags are checked against what `registerKit()` will define, keys against the manifest, and the
 * resolver that matters most is the one whose miss is SILENT. `commandIcon()` falls back to the
 * command's title, so a miss there degrades visibly and is a judgement call; a record's key falls
 * back to nothing.
 *
 * **Two rules left with Spectrum, and only one of them was re-aimed.** Rule 1 read `<sp-icon-*>`
 * tags against the table in `src/ui/spectrum.ts`; the tags are `jx-*` now and the table is
 * `KIT_TAGS`, so the rule is the same question about a substrate that still exists. Its allow-list
 * is gone with it: `UNWRITTEN` held sixteen registered-but-unwritten `sp-icon-*` rows and existed
 * because a Spectrum component registered icons into its OWN shadow DOM, so an unwritten row could
 * not be deleted on that evidence. The kit defines an element per DOCUMENT it ships rather than per
 * import a template happens to make, so a kit tag nothing writes is `@jxsuite/ui`'s business and
 * not this package's, and the rule now only runs in the direction that can be silent here.
 *
 * The old rule 2 — "a registered element `ui/spectrum.ts` never imports, or imports from a package
 * that is not installed" — is NOT re-aimed, and that is a decision rather than an omission. It
 * existed because Spectrum's registry was hand-written: a row named a tag, a separate `import`
 * named a class, and the two could disagree in three ways (a typo, a class from the wrong one of
 * the two icon packages, an uninstalled dependency), none of which the type checker saw. The kit
 * moved that seam rather than removing it, and this file is the wrong side of it. `registerUi()`
 * defines each tag from the document itself, so a tag and a class can no longer disagree — but
 * `packages/ui/src/documents.ts` is still a hand-written map, and a component whose JSON nothing
 * imports there ships in the repository, passes every per-document check, and is not an element at
 * runtime. That is the same failure one step along, and it is gated where it now lives:
 * `packages/ui/tests/conformance.test.ts`'s "every authored component is a registered document"
 * holds `components/*.json` and `documents` to the same set, and each key to the tag its document
 * declares. Re-aiming rule 2 here would mean this script reading another package's registry to
 * re-prove what that package's own suite proves.
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { ICON_NAMES } from "@jxsuite/ui/icons";
import { KIT_TAGS } from "@jxsuite/ui";
import { join } from "node:path";
import { Glob } from "bun";

const STUDIO = fileURLToPath(new URL("..", import.meta.url));

/**
 * Every `jx-*` TAG a surface document declares, mapped to the documents that declare it.
 *
 * Only a `tagName` value. A quoted `"jx-icon"` somewhere else is prose or a selector; a name on an
 * `icon:` key belongs to {@link iconKeysDeclared} — reading either here is the conflation this file
 * exists to prevent.
 */
export function kitTagsUsed(root: string): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const rel of new Glob("surfaces/**/*.json").scanSync(root)) {
    const text = readFileSync(join(root, rel), "utf8");
    for (const m of text.matchAll(/"tagName":\s*"(jx-[a-z0-9-]+)"/g)) {
      const at = used.get(m[1]!);
      if (at) {
        if (!at.includes(rel)) {
          at.push(rel);
        }
        continue;
      }
      used.set(m[1]!, [rel]);
    }
  }
  return used;
}

/**
 * The glyph names the UI kit ships — the ONE key space a panel record's `icon` resolves in. The
 * rail draws every record's icon through `jx-icon`, whose manifest is `@jxsuite/ui`'s, so a name
 * absent from it draws nothing and warns once.
 */
export function manifestNames(): Set<string> {
  return new Set(ICON_NAMES);
}

/**
 * Every `icon:` key a **panel record** declares, mapped to where it is declared.
 *
 * Scoped to `registerPanel(` calls that are ON the rail, because those are the only records whose
 * icon is drawn by the rail surface. A command record's `icon` goes to `commandIcon()`, which falls
 * back to the title; a settings section's is documented as reserved and read by nobody. Neither is
 * silent, so neither is enforced here, and sweeping them in is what inflated the first version's
 * count to 83 icons "all registered" while three rail buttons drew nothing.
 */
export function iconKeysDeclared(root: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const rel of new Glob("**/*.ts").scanSync(root)) {
    const text = readFileSync(join(root, rel), "utf8");
    for (const call of text.matchAll(/registerPanel\(\{/g)) {
      const open = call.index! + call[0].length - 1;
      let depth = 0;
      let end = open;
      for (let i = open; i < text.length; i += 1) {
        if (text[i] === "{") {
          depth += 1;
        } else if (text[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const record = text.slice(open, end);
      // `rail: false` means no button, and the rail is the only thing that draws the glyph — so an icon
      // On an off-rail panel reaches nothing at all, and demanding a row for it would be demanding
      // A row that can never run. Insert, State, Logic and Activity are all reachable by name
      // Instead of by number, which is the point of the flag.
      if (/\brail:\s*false/.test(record)) {
        continue;
      }
      const icon = /\bicon:\s*"([a-z0-9-]+)"/.exec(record);
      if (icon) {
        const line = text.slice(0, open + icon.index!).split("\n").length;
        declared.set(icon[1]!, `${rel}:${line}`);
      }
    }
  }
  return declared;
}

/**
 * The two rules, over stated inputs.
 *
 * Pure so a test can hand it a registry that is wrong — the shipped tree is correct by
 * construction, so a checker that only ever reads the real files can never exercise the branch that
 * reports a problem, and the branch that reports a problem is the whole point of it.
 */
export function iconProblems(input: {
  /** Tag → the documents declaring it as a `tagName`. */
  tags: Map<string, string[]>;
  /** The tags `registerKit()` will define — `KIT_TAGS`. */
  registered: Set<string>;
  /** The glyph names the kit's manifest carries. */
  rows: Set<string>;
  /** Panel-record key → where it is declared. */
  keys: Map<string, string>;
}): string[] {
  const { keys, registered, rows, tags } = input;
  const problems: string[] = [];

  for (const [tag, files] of [...tags].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (!registered.has(tag)) {
      problems.push(
        `<${tag}> is declared by ${files.join(", ")} and the kit defines no such element — ` +
          `it renders as an empty box (add the component to packages/ui/components/, or name ` +
          `one the kit ships)`,
      );
    }
  }

  for (const [key, where] of [...keys].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (!rows.has(key)) {
      problems.push(
        `${where} declares icon "${key}" and the kit's icon manifest has no glyph of that name — ` +
          `the rail button renders NOTHING above its label (add it to packages/ui/icons/list.json ` +
          `and run build:icons, or name a glyph the manifest has)`,
      );
    }
  }

  return problems;
}

/**
 * {@link iconProblems}, against the real tree.
 *
 * @returns The problems, plus the two counts the reporter prints on success.
 */
export function checkIcons(): { problems: string[]; tagCount: number; keyCount: number } {
  const src = join(STUDIO, "src");
  const tags = kitTagsUsed(src);
  const keys = iconKeysDeclared(src);
  const problems = iconProblems({
    keys,
    registered: new Set(KIT_TAGS),
    rows: manifestNames(),
    tags,
  });
  return { keyCount: keys.size, problems, tagCount: tags.size };
}

/**
 * Print the verdict and hand back an exit code — the shape `check-pane-singletons.ts` and
 * `check-styles.ts` use, and for the reason their docstrings give: a function that RETURNS the code
 * is one a test can run, where a `process.exit` inside `import.meta.main` is one nothing can.
 *
 * @returns 0 when every icon reaches the DOM, 1 when one does not.
 */
export function report(problems: string[], tagCount: number, keyCount: number): number {
  if (problems.length > 0) {
    console.error(`\n❌ icons: ${problems.length} problem(s)\n`);
    for (const line of problems) {
      console.error(`   ${line}`);
    }
    console.error(
      '\n   Two key spaces, two fixes. A TAG (`"tagName": "jx-x"` in a surface document) needs a\n' +
        "   component document in `packages/ui/components/` — the kit defines one element per\n" +
        '   document it ships. A KEY (`icon: "x"` on a panel record) needs a glyph in the\n' +
        "   kit's manifest (packages/ui/icons/list.json, then `bun run build:icons`); defining an\n" +
        "   element does NOT help, because a key that misses returns `nothing` before any tag is\n" +
        "   constructed.\n",
    );
    return 1;
  }
  console.log(`✓ check-icons: ${tagCount} kit tag(s) defined, ${keyCount} panel key(s) resolved.`);
  return 0;
}

if (import.meta.main) {
  const { keyCount, problems, tagCount } = checkIcons();
  const code = report(problems, tagCount, keyCount);
  process.exit(code);
}
