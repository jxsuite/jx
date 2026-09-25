/**
 * Guard the template layer against the two ways a lit binding stops being the truth.
 *
 * Studio is already a lit app — 92 render roots, `data-jx-region` stamped from templates,
 * `classMap` and `ref` throughout. What it lacked was a rule about where the template's authority
 * ends, and both failures this file checks shipped because of that:
 *
 * - A control that owns its own state, bound by ATTRIBUTE or by a plain property. A control the
 *   reader can type into or click does not reflect `value` (nor a `<details>` its `open`), and it
 *   moves that property itself. So lit commits, the control moves the property, and the next render
 *   carrying the value lit already wrote is dirty-checked away — the write it needed to make is the
 *   one it skips. `.value=${live(x)}` compares against the LIVE property and cannot be fooled. The
 *   bug is invisible: nothing throws, the control simply keeps a value the document does not have.
 *
 *   **The tag list is the native controls now, and that is the rule outliving its first subject.** It
 *   was `sp-textfield|picker|search|number-field|combobox|checkbox|switch|slider|radio|
 *   accordion-item` — Adobe Spectrum's self-mutating set — and every one of those is gone. Nothing
 *   about the hazard was Spectrum's: it is why lit ships `live()` at all, and `<input>`, `<select>`
 *   and `<textarea>` have it by specification. `grid/cell-editors.ts` still renders all three from
 *   lit templates — it is the one module left that does — so the rule has a live subject rather than
 *   a re-pointed name, and re-aiming it turned up two real sites there on the first run. It
 *   deliberately does NOT cover the kit's `jx-*` controls: those are only ever written by a Jx
 *   document, `check-surface-purity.ts` rule 1 refuses one inside a lit template, and a document's
 *   binding is not dirty-checked against what lit last committed.
 * - A module reaching a node it renders itself, by selector. The node is real until the next render
 *   replaces it, and then the handle is detached or the query finds a sibling pane's copy instead.
 *   `packages/studio/src/surfaces/target-line.ts` states the rule in its own header — "a
 *   module-local handle rather than a querySelector at call time" — and `ref()` is how you get
 *   one.
 *
 * Both rules FAIL BOTH WAYS, in this package's idiom (see `scripts/check-pane-singletons.ts` and
 * `scripts/check-styles.ts`'s ALLOWED_ORPHANS): a new occurrence fails, and an allow-list entry
 * that has been fixed fails too. The lists can only ratchet down, and every entry carries a reason
 * rather than a bare count, because a bare number cannot be told apart from an oversight.
 *
 * What is deliberately NOT checked, and why, is {@link EXCLUDED} — the canvas. Those modules are
 * imperative by design, not by neglect, and an allow-list entry is how that gets said out loud
 * instead of looking like a gap.
 *
 * Source-only: no build, no type-checker, runs in about a second. Wired into the CI `checks` job.
 */

import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

// ─── Rule 1: a self-mutating control binds its own state as a live property ──────────────────

/**
 * Elements that own a piece of state the reader can change directly. The list is not "every form
 * element" — it is the ones whose own interaction writes a property lit also writes.
 */
const SELF_MUTATING = /(?:input|select|textarea|details)/.source;

/** The properties those elements move behind lit's back. */
const GUARDED_PROPS = ["value", "checked", "open"] as const;

export interface Finding {
  /** Workspace-relative path, POSIX. */
  file: string;
  line: number;
  detail: string;
}

/** Walk a `${` at `i`, returning the expression text and the index just past its `}`. */
function readExpression(source: string, i: number): { expr: string; end: number } | null {
  if (source.slice(i, i + 2) !== "${") {
    return null;
  }
  let depth = 0;
  let j = i + 1;
  while (j < source.length) {
    const c = source[j]!;
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      j += 1;
      while (j < source.length && source[j] !== quote) {
        j += source[j] === "\\" ? 2 : 1;
      }
    } else if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return { expr: source.slice(i + 2, j), end: j + 1 };
      }
    }
    j += 1;
  }
  return null;
}

/** The opening-tag text of every self-mutating element in `source`, with its line. */
export function selfMutatingOpenTags(source: string): {
  tag: string;
  attrs: string;
  line: number;
}[] {
  const out: { tag: string; attrs: string; line: number }[] = [];
  for (const m of source.matchAll(new RegExp(String.raw`<(${SELF_MUTATING})\b`, "g"))) {
    let k = m.index + m[0].length;
    let depth = 0;
    while (k < source.length) {
      const c = source[k]!;
      if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
      } else if (c === ">" && depth <= 0) {
        break;
      }
      k += 1;
    }
    out.push({
      attrs: source.slice(m.index + m[0].length, k),
      line: source.slice(0, m.index).split("\n").length,
      tag: m[1]!,
    });
  }
  return out;
}

/**
 * Bindings on a self-mutating control that lit cannot be trusted to re-commit: an attribute
 * binding, or a property binding without {@link live}.
 *
 * A constant (`.open=${false}`) is not a finding — there is nothing for the control to diverge
 * from.
 */
export function unguardedLiveBindings(file: string, source: string): Finding[] {
  const found: Finding[] = [];
  for (const { tag, attrs, line } of selfMutatingOpenTags(source)) {
    for (const prop of GUARDED_PROPS) {
      const asProperty = new RegExp(String.raw`\.` + prop + String.raw`=(?=\$\{)`).exec(attrs);
      const asAttribute = new RegExp(String.raw`(?<![.\w])\??` + prop + String.raw`=(?=\$\{)`).exec(
        attrs,
      );
      const at = asProperty ?? asAttribute;
      if (!at) {
        continue;
      }
      const read = readExpression(attrs, at.index + at[0].length);
      const expr = (read?.expr ?? "").trim();
      if (expr === "true" || expr === "false" || expr === "nothing") {
        continue;
      }
      if (asProperty && expr.startsWith("live(")) {
        continue;
      }
      found.push({
        detail: asProperty
          ? `<${tag}> binds .${prop} without live()`
          : `<${tag}> binds ${prop} as an attribute`,
        file,
        line,
      });
    }
  }
  return found;
}

// ─── Rule 2: a module does not reach its own rendered nodes by selector ──────────────────────

/** Class names this module emits from a template — `class="a b"`, and `classMap` keys. */
export function emittedClasses(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/\bclass=(["'`])([^"'`$]*)\1/g)) {
    for (const token of m[2]!.split(/\s+/)) {
      if (token) {
        names.add(token);
      }
    }
  }
  for (const m of source.matchAll(/classMap\(\{([^}]*)\}/g)) {
    for (const k of m[1]!.matchAll(
      /[{,]?\s*(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z_$][\w$-]*))\s*:/g,
    )) {
      const name = k[1] ?? k[2] ?? k[3];
      if (name) {
        names.add(name);
      }
    }
  }
  return names;
}

/**
 * `querySelector`/`querySelectorAll` calls naming a class this same module renders.
 *
 * Scoped to a literal `.class` selector on purpose. An attribute or tag selector is usually
 * reaching into something else's DOM (Spectrum's shadow root, Tabulator's cells, the canvas
 * iframe), which is a different act and not this rule's business.
 */
export function selfQueries(file: string, source: string): Finding[] {
  const mine = emittedClasses(source);
  if (mine.size === 0) {
    return [];
  }
  const found: Finding[] = [];
  for (const m of source.matchAll(/querySelector(?:All)?(?:<[^>]*>)?\(\s*(["'`])([^"'`$]+)\1/g)) {
    for (const cls of m[2]!.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      if (mine.has(cls[1]!)) {
        found.push({
          detail: `queries .${cls[1]} — a class this module renders; use ref()`,
          file,
          line: source.slice(0, m.index).split("\n").length,
        });
        break;
      }
    }
  }
  return found;
}

// ─── The excluded zone, said out loud ────────────────────────────────────────────────────────

/**
 * Modules the rules do not apply to, each with the reason.
 *
 * These are imperative BY DESIGN. The canvas patcher exists so that nothing re-renders on an edit;
 * the overlay and drag-ghost place boxes per pointer-move against measured geometry; the iframe
 * modules run in another realm that lit does not reach at all. Applying a template rule to them
 * would not improve them, and leaving them merely unmentioned would read as an oversight.
 */
/**
 * The modules that may still WRITE a lit template, each with the reason it is not a document.
 *
 * §9.3 says lit is "named and bounded" now. It was prose: nothing carried the names, so the
 * sentence could go stale without a gate noticing, and an adversarial pass found exactly that. This
 * is the list, and it only ratchets DOWN — a module that stops drawing must leave it, and a module
 * that starts drawing has to argue for an entry.
 *
 * An `import { nothing }` is NOT drawing: a panel record whose `render` returns the sentinel and
 * whose `afterRender` mounts a document is the seam, not a survival. Only `html`-tagged templates
 * count, which is what {@link litTemplateCount} measures.
 */
export const LIT_TEMPLATE_AUTHORS: Record<string, string> = {
  "grid/cell-editors.ts":
    "renders INTO Tabulator's cells. `Edit.edit()` appends the editor and reads its own subtree in " +
    "the same synchronous statement, so a mount that resolves a microtask later is always too late",
  "panels/activity-panel.ts":
    "two empty containers for two mounted documents — the panel seam itself, drawn once",
  "format/convert-file.ts":
    "a rich confirm BODY, which §9.4 sanctions as an island: `showConfirmDialog`'s `message` takes " +
    'a template and the dialog document renders it into `[part="island"]`. It reaches lit through ' +
    'a DYNAMIC `await import("lit-html")`, which is why every static inventory of this migration ' +
    "was one module short until this rule existed",
  "shell/tree.ts":
    "the four #layer-* hosts. Their rules are a LINKED stylesheet because the frame must be laid " +
    "out by the first paint, which is why surfaces/shell.json carries no style key",
};

/**
 * How many `html`-tagged templates a module writes. An imported `nothing` is not one.
 *
 * Matched by the POSITION a tagged template can occupy — after an operator, a bracket, a comma or
 * whitespace — rather than by "not a word character before it". Prose is full of near misses that
 * the loose form counts: `` `index.html` `` ends in the same two characters a template starts with,
 * `lit-html` does too, and a docstring listing `` `css` / `html` / `json` `` does it a third way.
 * All eleven of those read as lit authors before this was tightened.
 */
export function litTemplateCount(source: string): number {
  return (source.match(/(?:^|[\s(,=[{:?>&|!;])html`/g) ?? []).length;
}

export const EXCLUDED: Record<string, string> = {
  "canvas/canvas-patcher.ts":
    "classifies document ops so that nothing re-renders; contains no DOM and no markup",
  "canvas/canvas-utils.ts":
    "measure-then-write pan/zoom geometry, including the hard invariant that applyEditZoom must " +
    "never trigger a canvas re-render (it would destroy a live inline-edit session)",
  "canvas/iframe-host.ts":
    "owns the canvas iframe and its overlay children through replaceChildren, on per-pointer-move " +
    "hot paths, behind a token and origin handshake",
  "canvas/iframe-overlay.ts":
    "places selection, hover and drop boxes per pointer-move; one pointer-events:auto button whose " +
    "listeners are bound once and whose hover flag vetoes a later-arriving hide",
  "panels/drag-ghost.ts":
    "one reused position:fixed element moved every pointermove, deliberately outside the scaled wrap",
  "utils/geometry.ts": "the measurement funnel; tests/geometry.test.ts already guards it",
};

/** Everything under these prefixes is excluded for the reason on the prefix. */
const EXCLUDED_PREFIXES: Record<string, string> = {
  "canvas/iframe-": "runs in the canvas realm, rendered by the runtime rather than by lit",
};

function isExcluded(file: string): boolean {
  return (
    file in EXCLUDED || Object.keys(EXCLUDED_PREFIXES).some((prefix) => file.startsWith(prefix))
  );
}

// ─── The debt, which only shrinks ────────────────────────────────────────────────────────────

/**
 * Spectrum bindings not yet moved onto the live property — a **shrinking backlog**, not a
 * configuration knob.
 *
 * Every entry is a surface where the reader can move a control the template also writes, and the
 * count is what stops a new one being added quietly beside an existing one. The check fails both
 * ways: a count that grows fails, and a count left high after a site is fixed fails too, so the
 * list can only ratchet down. Discharge an entry by binding `.prop=${live(expr)}` and lowering the
 * number in the same change.
 *
 * Most are here because divergence has not been DEMONSTRATED, not because it is impossible — a
 * one-shot dialog has no re-render for the dirty-check to skip. Inline comments mark the files
 * where there is something more specific to say.
 */
export const LIVE_BINDING_DEBT: Record<string, number> = {
  /* Empty, and that is the ratchet arriving at zero rather than a list waiting to be filled. The
     last entry was the colour row's `<sp-picker>` of tokens, held open because `specs/ui.md` §5.6
     was Pending; §5.6 landed, the row is a `jx-color-field` in the Style tab's own document, and
     `ui/color-selector.ts` no longer renders anything. A new entry needs the reason a binding
     cannot be `live()`, as every retired one carried. */
};

/**
 * Selector reads of a module's own rendered nodes — same discipline, same ratchet.
 *
 * Discharge an entry by taking a handle with `ref()` at the site that renders the node, as
 * `src/surfaces/target-line.ts` describes, and lowering the number. Note that a legitimately
 * imperative USE — a measurement, a scrollIntoView, a focus move — is not what this rule objects
 * to; it objects to re-finding the node by selector every time instead of holding it.
 */
export const SELF_QUERY_DEBT: Record<string, number> = {
  /* Empty, and — as with LIVE_BINDING_DEBT above — that is the ratchet arriving at zero rather than a
     list waiting to be filled. The last entry was `ui/value-selector.ts`, whose `_setPopoverWidth`
     re-found its own `sp-popover` by selector on every open to copy the trigger's width onto it.
     The dual-mode combobox it belonged to had already lost every caller — the Style tab's unit row
     and the Logic tab's event name are documents over the kit now — so the module was deleted whole
     rather than given a `ref()`. A new entry needs the reason a handle cannot be taken at the site
     that renders the node, as every retired one carried. */
};

// ─── Runner ──────────────────────────────────────────────────────────────────────────────────

export interface Report {
  liveBindings: Finding[];
  selfQuery: Finding[];
  staleLiveBindings: string[];
  staleSelfQuery: string[];
  unknownExclusions: string[];
  /** Modules writing a lit template with no entry in {@link LIT_TEMPLATE_AUTHORS}. */
  undeclaredAuthors: string[];
  /** Entries whose module writes no template any more — the list only ratchets down. */
  staleAuthors: string[];
}

export function analyze(root = SRC): Report {
  const files = [...new Glob("**/*.ts").scanSync(root)]
    .map((f) => f.replaceAll("\\", "/"))
    .toSorted();
  const liveBindings: Finding[] = [];
  const selfQuery: Finding[] = [];
  const liveBindingsBy = new Map<string, number>();
  const selfQueryBy = new Map<string, number>();
  const authoring = new Set<string>();

  for (const file of files) {
    if (isExcluded(file)) {
      continue;
    }
    const source = readFileSync(join(root, file), "utf8");
    if (litTemplateCount(source) > 0) {
      authoring.add(file);
    }
    const s = unguardedLiveBindings(file, source);
    const q = selfQueries(file, source);
    if (s.length > 0) {
      liveBindingsBy.set(file, s.length);
    }
    if (q.length > 0) {
      selfQueryBy.set(file, q.length);
    }
    liveBindings.push(...s.filter(() => (LIVE_BINDING_DEBT[file] ?? 0) === 0));
    selfQuery.push(...q.filter(() => (SELF_QUERY_DEBT[file] ?? 0) === 0));
  }

  // Over budget in a file that has one: report the excess, named.
  for (const [file, actual] of liveBindingsBy) {
    const allowed = LIVE_BINDING_DEBT[file] ?? 0;
    if (allowed > 0 && actual > allowed) {
      liveBindings.push({
        detail: `${actual} unguarded live binding(s), ${allowed} allowed`,
        file,
        line: 0,
      });
    }
  }
  for (const [file, actual] of selfQueryBy) {
    const allowed = SELF_QUERY_DEBT[file] ?? 0;
    if (allowed > 0 && actual > allowed) {
      selfQuery.push({ detail: `${actual} self-queries, ${allowed} allowed`, file, line: 0 });
    }
  }

  const known = new Set(files);
  return {
    selfQuery,
    liveBindings,
    staleSelfQuery: Object.entries(SELF_QUERY_DEBT)
      .filter(([f, n]) => (selfQueryBy.get(f) ?? 0) < n)
      .map(([f, n]) => `${f} (allows ${n}, found ${selfQueryBy.get(f) ?? 0})`),
    staleLiveBindings: Object.entries(LIVE_BINDING_DEBT)
      .filter(([f, n]) => (liveBindingsBy.get(f) ?? 0) < n)
      .map(([f, n]) => `${f} (allows ${n}, found ${liveBindingsBy.get(f) ?? 0})`),
    unknownExclusions: Object.keys(EXCLUDED).filter((f) => !known.has(f)),
    undeclaredAuthors: [...authoring].filter((f) => !(f in LIT_TEMPLATE_AUTHORS)).toSorted(),
    staleAuthors: Object.keys(LIT_TEMPLATE_AUTHORS)
      .filter((f) => !authoring.has(f))
      .toSorted(),
  };
}

/** One rule's report, as lines. Pure, so the runner is a join and the tests need no console spy. */
export function reportLines(
  findings: readonly Finding[],
  heading: string,
  advice: string,
): string[] {
  if (findings.length === 0) {
    return [];
  }
  return [
    "",
    heading,
    "",
    ...findings
      .toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
      .map((f) => `  src/${f.file}${f.line > 0 ? `:${f.line}` : ""} — ${f.detail}`),
    "",
    `  ${advice}`,
  ];
}

/** The whole report, and whether it is a failure. */
export function report(r: Report): { lines: string[]; failed: boolean } {
  const lines = [
    ...reportLines(
      r.liveBindings,
      "Self-mutating controls bound so that lit cannot re-commit them:",
      "These controls move `value` / `checked` / `open` themselves and do not reflect them, so " +
        "an attribute binding — or a property binding without live() — is dirty-checked away " +
        "exactly when it was needed. Bind `.prop=${live(expr)}`, or add the file to LIVE_BINDING_DEBT " +
        "with the reason it cannot be.",
    ),
    ...reportLines(
      r.selfQuery,
      "Modules reaching their own rendered nodes by selector:",
      "The node is only real until the next render, and with a second pane the query can find " +
        "someone else's. Take a handle with ref(), as src/surfaces/target-line.ts describes, or add " +
        "the file to SELF_QUERY_DEBT with the reason.",
    ),
  ];
  for (const [label, stale] of [
    ["LIVE_BINDING_DEBT", r.staleLiveBindings],
    ["SELF_QUERY_DEBT", r.staleSelfQuery],
  ] as const) {
    if (stale.length > 0) {
      lines.push(
        "",
        `Stale ${label} entr(ies) — the list only ratchets down:`,
        "",
        ...stale.map((s) => `  ${s}`),
        "",
        "  Lower the count, or delete the entry.",
      );
    }
  }
  if (r.undeclaredAuthors.length > 0) {
    lines.push(
      "",
      "These modules write a lit template and are not in LIT_TEMPLATE_AUTHORS:",
      "",
      ...r.undeclaredAuthors.map((f) => `  ${f}`),
      "",
      "  Studio's chrome is Jx documents (studio-ui-guidelines.md §9.3). A module that draws with",
      "  lit needs an entry saying why it cannot be a document — or it needs to become one.",
    );
  }
  if (r.staleAuthors.length > 0) {
    lines.push(
      "",
      "Stale LIT_TEMPLATE_AUTHORS entr(ies) — the list only ratchets down:",
      "",
      ...r.staleAuthors.map((f) => `  ${f} writes no template any more`),
      "",
      "  Delete the entry.",
    );
  }
  if (r.unknownExclusions.length > 0) {
    lines.push(
      "",
      "EXCLUDED names files that no longer exist:",
      "",
      ...r.unknownExclusions.map((f) => `  ${f}`),
    );
  }
  if (lines.length > 0) {
    return { failed: true, lines };
  }
  /* One sum over both lists rather than one per list. Two `reduce`s meant two callbacks, and a
     `reduce` over an empty array with a seed never calls its own — so the moment LIVE_BINDING_DEBT
     ratcheted to zero, half of this line stopped being executed while still reading as covered. */
  const debt = [...Object.values(LIVE_BINDING_DEBT), ...Object.values(SELF_QUERY_DEBT)].reduce(
    (a, n) => a + n,
    0,
  );
  return {
    failed: false,
    lines: [
      `✓ check-lit-conventions: self-mutated state binds live, no module queries its own nodes, ` +
        `${Object.keys(LIT_TEMPLATE_AUTHORS).length} module(s) still author a lit template ` +
        `(${debt} allow-listed site(s) remaining, ${Object.keys(EXCLUDED).length} module(s) excluded ` +
        `by design).`,
    ],
  };
}

if (import.meta.main) {
  const { failed, lines } = report(analyze());
  console.log(lines.join("\n"));
  process.exit(failed ? 1 : 0);
}
