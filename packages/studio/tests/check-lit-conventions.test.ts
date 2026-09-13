/**
 * The conventions gate proves itself before it gates anything.
 *
 * Same discipline as `tests/check-styles-orphans.test.ts` and `tests/icons.test.ts`: the rules are
 * pure functions over injected source, so they can be driven with fixtures under `bun test`, which
 * never builds and never opens a browser. What is asserted here is not "the current tree is clean"
 * — the runner says that — but that each rule fires on the shape it exists for, stays quiet on the
 * shape it does not, and that both backlogs ratchet in both directions.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  analyze,
  emittedClasses,
  EXCLUDED,
  litTemplateCount,
  report,
  reportLines,
  SELF_QUERY_DEBT,
  LIVE_BINDING_DEBT,
  selfQueries,
  unguardedLiveBindings,
} from "../scripts/check-lit-conventions";

/** A throwaway src/ tree, written verbatim. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "jx-lit-conv-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

function withTree<T>(files: Record<string, string>, body: (root: string) => T): T {
  const root = tree(files);
  try {
    return body(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

// ─── Rule 1: self-mutating controls ──────────────────────────────────────────

/*
 * The subject changed and the rule did not. It was Adobe Spectrum's self-mutating set — every one
 * of those tags is gone — and it is the NATIVE one now: nothing about the hazard was Spectrum's,
 * it is why lit ships `live()` at all, and `<input>`, `<select>` and `<textarea>` have it by
 * specification. Studio still renders all three from lit templates, so these assertions have a live
 * subject rather than a renamed one.
 */
describe("unguardedLiveBindings", () => {
  test("an attribute binding on a self-mutating control is a finding", () => {
    const f = unguardedLiveBindings("a.ts", "html`<textarea value=${x}></textarea>`");
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("binds value as an attribute");
  });

  test("a property binding without live() is a finding — the dirty-check still skips it", () => {
    const f = unguardedLiveBindings("a.ts", "html`<select .value=${x}></select>`");
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("without live()");
  });

  test("a live property binding is clean", () => {
    expect(unguardedLiveBindings("a.ts", "html`<select .value=${live(x)}></select>`")).toEqual([]);
  });

  test("boolean attribute and property forms are both judged", () => {
    expect(unguardedLiveBindings("a.ts", "html`<input ?checked=${x}>`")).toHaveLength(1);
    expect(unguardedLiveBindings("a.ts", "html`<input .checked=${live(x)}>`")).toEqual([]);
  });

  test("a details element's open counts — the reader flips it themselves", () => {
    expect(unguardedLiveBindings("a.ts", "html`<details open=${x}>`")).toHaveLength(1);
  });

  /* A constant cannot diverge: there is nothing for the control to move away from. */
  test("constants are not findings", () => {
    expect(unguardedLiveBindings("a.ts", "html`<details .open=${false}>`")).toEqual([]);
    expect(unguardedLiveBindings("a.ts", "html`<select .value=${nothing}>`")).toEqual([]);
  });

  test("a kit control is none of this rule's business", () => {
    /* `jx-*` elements are only ever written by a Jx document — `check-surface-purity.ts` rule 1
       refuses one inside a lit template — and a document's binding is not dirty-checked against
       what lit last committed. Covering them here would be a rule that can never fire. */
    expect(unguardedLiveBindings("a.ts", "html`<jx-textfield value=${x}>`")).toEqual([]);
  });

  test("a display element that owns nothing is not a control", () => {
    expect(unguardedLiveBindings("a.ts", "html`<div value=${x}>`")).toEqual([]);
  });

  /* The binding is often several lines below the tag name, and the expression can carry braces of
     its own — a ternary, an object, a nested template. Both have to survive the scan. */
  test("multi-line tags and braced expressions are still read", () => {
    const src = ["html`<select", '  class="x"', "  value=${a ? { k: 1 } : `${b}`}", ">`"].join(
      "\n",
    );
    const f = unguardedLiveBindings("a.ts", src);
    expect(f).toHaveLength(1);
    expect(f[0]!.line).toBe(1);
  });

  /* `.value` must not be mistaken for the attribute `value`, in either direction. */
  test("the property form is not double-counted as an attribute", () => {
    expect(unguardedLiveBindings("a.ts", "html`<select .value=${live(x)} >`")).toEqual([]);
  });
});

// ─── Rule 2: self-queries ────────────────────────────────────────────────────

describe("emittedClasses", () => {
  test("reads plain class attributes and classMap keys, quoted or bare", () => {
    const names = emittedClasses(
      'html`<div class="a b"><i class=${classMap({ "c-d": t, active: t })}></i></div>`',
    );
    expect([...names].toSorted()).toEqual(["a", "active", "b", "c-d"]);
  });

  /* An interpolated class name is not a literal this module can be said to own. */
  test("a class attribute containing an interpolation is skipped", () => {
    expect([...emittedClasses("html`<div class=${`tab-${kind}`}></div>`")]).toEqual([]);
  });
});

describe("selfQueries", () => {
  test("querying a class this module renders is a finding", () => {
    const f = selfQueries("a.ts", 'html`<div class="own"></div>`; host.querySelector(".own");');
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain(".own");
  });

  test("querySelectorAll and a generic type argument are both read", () => {
    expect(
      selfQueries("a.ts", 'html`<div class="own">`; el.querySelectorAll<HTMLElement>(".own");'),
    ).toHaveLength(1);
  });

  test("querying someone else's class is not this rule's business", () => {
    expect(selfQueries("a.ts", 'html`<div class="own">`; host.querySelector(".theirs");')).toEqual(
      [],
    );
  });

  /* Reaching into a third-party widget by tag or attribute is a different act — Tabulator's cells,
     Monaco's own DOM, the canvas iframe — and the rule stays out of it. */
  test("tag and attribute selectors are left alone", () => {
    const src =
      'html`<div class="own">`; el.querySelector("tabulator-cell"); el.querySelector("[hidden]");';
    expect(selfQueries("a.ts", src)).toEqual([]);
  });
});

// ─── The ratchet ─────────────────────────────────────────────────────────────

describe("the backlogs ratchet in both directions", () => {
  const dirty =
    'html`<textarea value=${x}></textarea><div class="own"></div>`;\nhost.querySelector(".own");\n';

  test("an un-listed file reports both findings", () => {
    withTree({ "fresh.ts": dirty }, (root) => {
      const r = analyze(root);
      expect(r.liveBindings.map((f) => f.file)).toContain("fresh.ts");
      expect(r.selfQuery.map((f) => f.file)).toContain("fresh.ts");
    });
  });

  /* Growing past the allowance is reported as an excess, naming both numbers, rather than as a
     wall of individual sites the reader has already agreed to. */
  test("exceeding an allowance is reported with both counts", () => {
    withTree({ "listed.ts": dirty }, (root) => {
      const key = "listed.ts";
      LIVE_BINDING_DEBT[key] = 0;
      try {
        const clean = analyze(root);
        expect(clean.liveBindings.some((f) => f.file === key)).toBeTrue();
      } finally {
        delete LIVE_BINDING_DEBT[key];
      }
    });
  });

  /**
   * The same claim, against an allowance that is actually SPENT — which is the branch the test
   * above never reached.
   *
   * It sets the allowance to `0`, so `analyze` takes the un-listed path and reports each site
   * individually; the "excess, naming both numbers" arm needs `allowed > 0 && actual > allowed`,
   * and nothing exercised it once both backlogs reached zero and no real file could supply the
   * inequality. So the two `detail` strings the reader is meant to see went unasserted, and each
   * arm is now pinned by the sentence it prints.
   */
  test("a file that grows past a NON-ZERO allowance is reported as an excess", () => {
    withTree({ "listed.ts": dirty + dirty }, (root) => {
      const key = "listed.ts";
      LIVE_BINDING_DEBT[key] = 1;
      SELF_QUERY_DEBT[key] = 1;
      try {
        const r = analyze(root);
        expect(r.liveBindings).toEqual([
          { detail: "2 unguarded live binding(s), 1 allowed", file: key, line: 0 },
        ]);
        expect(r.selfQuery).toEqual([{ detail: "2 self-queries, 1 allowed", file: key, line: 0 }]);
        // Spent to the last unit is not an excess: the ratchet allows what it says it allows.
        LIVE_BINDING_DEBT[key] = 2;
        SELF_QUERY_DEBT[key] = 2;
        const atBudget = analyze(root);
        expect(atBudget.liveBindings).toEqual([]);
        expect(atBudget.selfQuery).toEqual([]);
      } finally {
        delete LIVE_BINDING_DEBT[key];
        delete SELF_QUERY_DEBT[key];
      }
    });
  });

  test("a fixed site leaves a stale entry, which fails too", () => {
    withTree({ "listed.ts": "export const x = 1;\n" }, (root) => {
      LIVE_BINDING_DEBT["listed.ts"] = 2;
      SELF_QUERY_DEBT["listed.ts"] = 1;
      try {
        const r = analyze(root);
        expect(r.staleLiveBindings.join(", ")).toContain("listed.ts (allows 2, found 0)");
        expect(r.staleSelfQuery.join(", ")).toContain("listed.ts (allows 1, found 0)");
      } finally {
        delete LIVE_BINDING_DEBT["listed.ts"];
        delete SELF_QUERY_DEBT["listed.ts"];
      }
    });
  });

  test("an excluded module is not judged at all", () => {
    withTree({ "canvas/iframe-host.ts": dirty, "canvas/iframe-made-up.ts": dirty }, (root) => {
      const r = analyze(root);
      expect(r.liveBindings).toEqual([]);
      expect(r.selfQuery).toEqual([]);
    });
  });
});

// ─── The lists describe the tree they are in ─────────────────────────────────

describe("the lists stay honest about the real tree", () => {
  test("every EXCLUDED module exists", () => {
    expect(analyze().unknownExclusions).toEqual([]);
  });

  /* An exclusion is a claim that a module is imperative BY DESIGN, so it has to say why — a bare
     path is indistinguishable from something nobody got round to. */
  test("every exclusion carries a reason", () => {
    for (const [file, why] of Object.entries(EXCLUDED)) {
      expect(why.length, `${file} has no reason`).toBeGreaterThan(30);
    }
  });

  /**
   * The stale arm, against the REAL tree — the half that caught this slice's own half-done step.
   *
   * Both backlogs are empty now, so `analyze()` over `src/` can no longer produce a stale entry by
   * itself, and the fixture tests above prove the arm over a temporary tree instead. That is not
   * the same claim: the gate's whole value is that a file deleted from `src/` without its entry
   * being deleted goes red, and this asserts that over the directory the gate actually reads.
   */
  test("a debt entry naming a file the tree does not have is reported as stale", () => {
    SELF_QUERY_DEBT["ui/deleted-module.ts"] = 1;
    LIVE_BINDING_DEBT["ui/deleted-module.ts"] = 2;
    try {
      const r = analyze();
      expect(r.staleSelfQuery).toEqual(["ui/deleted-module.ts (allows 1, found 0)"]);
      expect(r.staleLiveBindings).toEqual(["ui/deleted-module.ts (allows 2, found 0)"]);
      // And the runner turns that into a red gate naming both, which is what a caller sees.
      const { failed, lines } = report(r);
      expect(failed).toBeTrue();
      expect(lines.join("\n")).toContain("ui/deleted-module.ts (allows 1, found 0)");
      expect(lines.join("\n")).toContain("ui/deleted-module.ts (allows 2, found 0)");
    } finally {
      delete SELF_QUERY_DEBT["ui/deleted-module.ts"];
      delete LIVE_BINDING_DEBT["ui/deleted-module.ts"];
    }
  });

  test("the committed tree is clean against its own backlogs", () => {
    const r = analyze();
    expect(r.liveBindings).toEqual([]);
    expect(r.selfQuery).toEqual([]);
    expect(r.staleLiveBindings).toEqual([]);
    expect(r.staleSelfQuery).toEqual([]);
  });
});

describe("report", () => {
  test("a clean tree names the backlog size and the excluded modules", () => {
    const { failed, lines } = report({
      selfQuery: [],
      liveBindings: [],
      staleSelfQuery: [],
      staleLiveBindings: [],
      unknownExclusions: [],
      undeclaredAuthors: [],
      staleAuthors: [],
    });
    expect(failed).toBe(false);
    expect(lines.join("\n")).toContain("allow-listed site(s) remaining");
  });

  /**
   * The NUMBER in that line, which nothing had ever read.
   *
   * The clean line's scoreboard is one sum over both backlogs, and the module comment beside it
   * records why it is one `reduce` and not two: a reduce over an empty array with a seed never
   * calls its own callback, so half the sum stopped being executed the moment `LIVE_BINDING_DEBT`
   * ratcheted to zero — while the LINE still read as covered. Both lists are empty now, so the
   * whole callback is in that position, and asserting "0 remaining" cannot tell a working sum from
   * a broken one. This gives it something to add up.
   */
  test("the backlog size in that line is the sum over BOTH lists", () => {
    LIVE_BINDING_DEBT["a.ts"] = 3;
    SELF_QUERY_DEBT["b.ts"] = 2;
    try {
      const { failed, lines } = report({
        selfQuery: [],
        liveBindings: [],
        staleSelfQuery: [],
        staleLiveBindings: [],
        unknownExclusions: [],
        undeclaredAuthors: [],
        staleAuthors: [],
      });
      expect(failed).toBe(false);
      expect(lines.join("\n")).toContain("(5 allow-listed site(s) remaining");
    } finally {
      delete LIVE_BINDING_DEBT["a.ts"];
      delete SELF_QUERY_DEBT["b.ts"];
    }
  });

  test("each finding names its file, its line and what to do", () => {
    const { failed, lines } = report({
      selfQuery: [{ detail: "queries .own", file: "a.ts", line: 7 }],
      liveBindings: [{ detail: "binds value as an attribute", file: "b.ts", line: 3 }],
      staleSelfQuery: [],
      staleLiveBindings: [],
      unknownExclusions: [],
      undeclaredAuthors: [],
      staleAuthors: [],
    });
    expect(failed).toBe(true);
    const text = lines.join("\n");
    expect(text).toContain("src/b.ts:3");
    expect(text).toContain("src/a.ts:7");
    expect(text).toContain("ref()");
  });

  /**
   * The lit-author rule, both directions.
   *
   * §9.3 says lit is "named and bounded" now, and that was prose until this rule carried the names.
   * An adversarial pass found the sentence citing an allow-list that did not hold the list — and
   * the rule, once written, immediately found a module every static inventory had missed, because
   * `format/convert-file.ts` reaches lit through a DYNAMIC `await import("lit-html")`.
   */
  test("an undeclared lit author and a stale entry are both reported", () => {
    const { failed, lines } = report({
      selfQuery: [],
      liveBindings: [],
      staleSelfQuery: [],
      staleLiveBindings: [],
      unknownExclusions: [],
      undeclaredAuthors: ["panels/new-thing.ts"],
      staleAuthors: ["shell/tree.ts"],
    });
    const text = lines.join("\n");
    expect(failed).toBe(true);
    expect(text).toContain("panels/new-thing.ts");
    expect(text).toContain("not in LIT_TEMPLATE_AUTHORS");
    expect(text).toContain("shell/tree.ts writes no template any more");
    expect(text).toContain("only ratchets down");
  });

  /* Prose is full of near misses, and the loose form of this counter matched eleven of them. */
  test("litTemplateCount counts tagged templates, not filenames or package names", () => {
    expect(litTemplateCount("const t = html`<p></p>`;")).toBe(1);
    expect(litTemplateCount("render(html`<a></a>`, host);")).toBe(1);
    expect(litTemplateCount("[html`<i></i>`, html`<b></b>`]")).toBe(2);
    // Each of these appeared in a real docstring and was counted before the rule was tightened.
    expect(litTemplateCount("a mismatch with `index.html` flashes the shell")).toBe(0);
    expect(litTemplateCount("stays free of the `lit-html` dependency")).toBe(0);
    expect(litTemplateCount("exports the `css` / `html` / `json` namespaces")).toBe(0);
  });

  /* Both ratchet directions, and a stale exclusion, reach the report rather than only the analysis. */
  test("stale entries and unknown exclusions are reported too", () => {
    const { failed, lines } = report({
      selfQuery: [],
      liveBindings: [],
      staleSelfQuery: ["x.ts (allows 1, found 0)"],
      staleLiveBindings: ["y.ts (allows 2, found 0)"],
      unknownExclusions: ["gone.ts"],
      undeclaredAuthors: [],
      staleAuthors: [],
    });
    expect(failed).toBe(true);
    const text = lines.join("\n");
    expect(text).toContain("only ratchets down");
    expect(text).toContain("y.ts (allows 2, found 0)");
    expect(text).toContain("gone.ts");
  });

  test("a finding with no line number omits the colon", () => {
    const lines = reportLines([{ detail: "3 sites, 1 allowed", file: "z.ts", line: 0 }], "H", "A");
    expect(lines.join("\n")).toContain("src/z.ts —");
  });
});
