/**
 * No Studio style rule addresses a part the kit keeps in the tree as a permanent, empty live
 * region.
 *
 * `jx-textfield`, `jx-select` and `jx-combobox` each draw a `<p part="error" aria-live="polite">`
 * that exists, empty, from the first render, because a live region announces nothing unless it was
 * in the tree before its text arrived (ui.md §5.1). The kit is light DOM, so a surface that styles
 * its OWN banner with `& [part="error"]` also reaches that paragraph in every field inside it. The
 * kit's `:empty` rule now resets the region whatever an ancestor sets, but before it did, Source
 * Control's banner rule drew a 16x13 box over the branch picker's and the commit field's top-left
 * corners and took the click, and the Assistant's error card drew an 18x12 red bar on the model
 * picker. The kit fix cannot help once the field has text, though: the refusal sentence then drew
 * as git-panel's banner, padding, rule and wash included. So a surface names its own refusal
 * `failure` (a dialog or panel banner) or `section-error` (a settings section), as add-repo,
 * publish, new-project, preferences and the settings sections already did.
 *
 * The reserved names are DERIVED from the kit: every part carried by a kit node with `aria-live`.
 * So are the elements a rule may anchor on to address that region on purpose (`jx-textfield
 * [part="error"]`): every kit element whose tree holds the region, directly or through another such
 * element, which is how `jx-color-field` inherits it from the text field it embeds. Only the
 * permanent live region is reserved. Banning every kit part name from surface selectors was
 * measured at over 300 existing descendant hits (`row`, `badge`, `chip`, ...), and none of those
 * can paint while invisible.
 *
 * Selectors are resolved with the runtime's own `resolveNestedSelector`, so a nested `&` block and
 * a comma list are read exactly as the emitted sheet reads them, and an at-rule block passes its
 * parent's selector through unchanged, as the runtime's own walk does.
 *
 * **The hand-written sheets are read too.** `styles/*.css` cascades over the same light DOM as the
 * surface documents, with no scope at all, so `.panel-footer [part="error"]` in `panels.css`
 * reaches every field inside every panel footer. A guard that checked only the documents would have
 * held the claim in this header for the JSON half of the styling and left the half that has the
 * wider reach unread.
 *
 * **And a name can collide across two documents, not just with the kit.** A surface that draws an
 * ISLAND hosts a whole other document in its own light DOM, so a descendant part selector the host
 * writes reaches the guest's nodes as well as its own. That is how renaming the managed-connect
 * refusal to the conventional `failure` walked it into `new-project.json`'s footer-banner rules.
 * The hosts are derived (a part named `island` or `*-island`); their guests cannot be, because the
 * wiring is a closure per island, so {@link ISLAND_GUESTS} names them and the test proves each
 * named host really draws the island it claims.
 *
 * **What this does NOT reach.** A host is only found by name, and `preferences.json` calls its two
 * boxes `managed-slot` and `creds-slot` — it is in the list because a rule of its own was reaching
 * the credentials form's `[part="key"]` field and `[part="title"]`, not because anything derived
 * it. Further out there is a whole family of boxes that code fills with something OTHER than a
 * surface document (a form field's `control-host`, the colour row's lit island, the signals tree),
 * and a guest list for those is not a set of files at all. So the list is the guard's reach:
 * widening it is a line per host, and the test below makes sure the convention-named ones cannot be
 * missed.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveNestedSelector, splitSelectorList } from "@jxsuite/runtime/css";
import { documents as kitDocuments } from "@jxsuite/ui/documents";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The element nodes under `value`, depth first, never descending into a `style` block.
 *
 * @yields {Json} Each object carrying a `tagName`, `value` itself first when it is one.
 */
function* elementsUnder(value: unknown): Generator<Json> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* elementsUnder(item);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (typeof value["tagName"] === "string") {
    yield value;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "style") {
      yield* elementsUnder(child);
    }
  }
}

/** The whitespace-separated part names a node's own attributes give it. */
function partsOf(node: Json): string[] {
  const { attributes } = node;
  const part = isObject(attributes) ? attributes["part"] : undefined;
  return typeof part === "string" ? part.split(/\s+/).filter(Boolean) : [];
}

/** Every part a kit node keeps in the tree as a live region: the nodes that carry `aria-live`. */
function reservedParts(docs: Readonly<Record<string, unknown>>): Set<string> {
  const reserved = new Set<string>();
  for (const doc of Object.values(docs)) {
    for (const node of elementsUnder(doc)) {
      const { attributes } = node;
      if (isObject(attributes) && "aria-live" in attributes) {
        for (const part of partsOf(node)) {
          reserved.add(part);
        }
      }
    }
  }
  return reserved;
}

/**
 * The kit elements whose tree holds a reserved region, directly or by embedding another element
 * that does, found by growing the set until a pass adds nothing.
 */
function regionHolders(
  docs: Readonly<Record<string, unknown>>,
  reserved: ReadonlySet<string>,
): Set<string> {
  const holders = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [tag, doc] of Object.entries(docs)) {
      const inner = [...elementsUnder(doc)].filter((node) => node !== doc);
      const holds = inner.some(
        (node) =>
          partsOf(node).some((part) => reserved.has(part)) ||
          holders.has(node["tagName"] as string),
      );
      if (holds && !holders.has(tag)) {
        holders.add(tag);
        grew = true;
      }
    }
  }
  return holders;
}

/**
 * Every rule selector a style block produces, fully resolved against `scope`. An at-rule block
 * (`@(forced-colors: active)`, `@media …`) is transparent: its keys resolve against the selector
 * the at-rule sits in.
 *
 * @yields {string} Each nested rule's selector.
 */
function* selectorsOf(block: Json, scope: string): Generator<string> {
  for (const [key, value] of Object.entries(block)) {
    const blocks = Array.isArray(value)
      ? value.filter((entry) => isObject(entry))
      : isObject(value)
        ? [value]
        : [];
    for (const child of blocks) {
      if (key.startsWith("@")) {
        yield* selectorsOf(child, scope);
      } else {
        const selector = resolveNestedSelector(scope, key);
        yield selector;
        yield* selectorsOf(child, selector);
      }
    }
  }
}

/**
 * Every rule selector in a document: its root style and every node's own style block.
 *
 * @yields {string} Each rule's selector, the root's resolved against `SCOPE` and a node's against
 *   `NODE`.
 */
function* documentSelectors(doc: Json): Generator<string> {
  for (const node of elementsUnder(doc)) {
    const { style } = node;
    if (isObject(style)) {
      yield* selectorsOf(style, node === doc ? "SCOPE" : "NODE");
    }
  }
}

/** `[part="x"]`, `[part~='x']` or `[part=x]`, with the name in whichever group matched. */
const PART_SELECTOR = /\[part~?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*\]/g;

/** The compound selector that ends right before `index` in `member`, past any combinator. */
function compoundBefore(member: string, index: number): string {
  const head = member.slice(0, index);
  // The compound the part selector itself belongs to starts after the last combinator or space.
  const own = head.search(/[^\s>+~]*$/);
  const before = head.slice(0, own).replace(/[\s>+~]+$/, "");
  return before.slice(before.search(/[^\s>+~]*$/));
}

/**
 * Each member of `selector` that addresses a reserved part without anchoring on a kit element that
 * holds the region. Anchoring (`jx-textfield [part="error"]`) is how a rule says it means the kit's
 * own sentence, and it is the only reading of a reserved name that is not a collision.
 */
function collisions(
  selector: string,
  reserved: ReadonlySet<string>,
  holders: ReadonlySet<string>,
): string[] {
  return splitSelectorList(selector).filter((member) =>
    [...member.matchAll(PART_SELECTOR)].some((match) => {
      const name = match[1] ?? match[2] ?? match[3] ?? "";
      if (!reserved.has(name)) {
        return false;
      }
      const anchor = /^[a-z][a-z0-9]*-[a-z0-9-]*/.exec(compoundBefore(member, match.index))?.[0];
      return anchor === undefined || !holders.has(anchor);
    }),
  );
}

const RESERVED = reservedParts(kitDocuments);
const HOLDERS = regionHolders(kitDocuments, RESERVED);

const STUDIO = resolve(import.meta.dir, "..");
const SOURCES = [
  ...readdirSync(join(STUDIO, "src/surfaces"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `src/surfaces/${name}`),
  ...readdirSync(join(STUDIO, "styles"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `styles/${name}`),
].toSorted();

const SHEETS = readdirSync(join(STUDIO, "styles"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => `styles/${name}`)
  .toSorted();

const read = (path: string) => JSON.parse(readFileSync(join(STUDIO, path), "utf8")) as Json;

/**
 * Every rule selector a hand-written sheet declares.
 *
 * A prelude is whatever sits between the last `;`, `{` or `}` and the next `{`, which reads a
 * nested block the same way it reads a top-level one; an at-rule's own prelude starts with `@` and
 * is dropped, while the rules inside it are found on the next pass of the same scan.
 *
 * @yields {string} Each rule's selector list, as written.
 */
function* sheetSelectors(css: string): Generator<string> {
  const text = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  for (const match of text.matchAll(/([^{}]*)\{/g)) {
    const prelude = match[1]!.slice(match[1]!.search(/[^;}]*$/)).trim();
    if (prelude !== "" && !prelude.startsWith("@")) {
      yield prelude;
    }
  }
}

/**
 * The surfaces mounted into each island-hosting surface's islands.
 *
 * A LIST rather than a derivation, because the wiring is a callback per island — `new-project.ts`
 * maps `creds-island` to `options.islands.creds`, and the modal passes `() => credsForm().render()`
 * — so nothing in the documents or the adapters says which document lands in which box. The cost of
 * the list is one line when an island gains a body, and the test below fails when a named host
 * stops drawing the island it is listed for, so it cannot rot into a no-op.
 */
const ISLAND_GUESTS: Readonly<Record<string, readonly string[]>> = {
  "dialog.json": ["grid-open.json", "push-plan.json"],
  "new-project.json": [
    "ai-credentials-form.json",
    "ai-managed-connect.json",
    "ai-model-picker.json",
  ],
  "preferences.json": [
    "ai-credentials-form.json",
    "ai-managed-connect.json",
    "ai-model-picker.json",
  ],
};

/**
 * The parts of every box a document draws and never fills: a mount point.
 *
 * Two shapes, because the naming convention is not universal. `island`/`*-island` is what
 * studio-ui-guidelines §9.4 calls one, and `preferences.json` calls its two `managed-slot` and
 * `creds-slot` — so a box is also read as a mount when it is a LEAF with `role="none"`: no
 * children, no `$switch`, no `$map`, no text. That is the document saying "somebody else puts
 * something here".
 */
function mountBoxes(doc: Json): string[] {
  return [...elementsUnder(doc)].flatMap((node) => {
    const attributes = isObject(node["attributes"]) ? node["attributes"] : {};
    const filled = ["children", "cases", "map", "$switch", "textContent"].some(
      (key) => node[key] !== undefined,
    );
    return partsOf(node).filter(
      (part) =>
        part === "island" || part.endsWith("-island") || (attributes["role"] === "none" && !filled),
    );
  });
}

/** Every part name the documents in `files` draw, mapped to the nodes that carry it. */
function drawnParts(files: readonly string[]): Map<string, GuestNode[]> {
  const drawn = new Map<string, GuestNode[]>();
  for (const file of files) {
    for (const node of guestNodes(read(`src/surfaces/${file}`), file)) {
      for (const part of partsOf(node.node)) {
        drawn.set(part, [...(drawn.get(part) ?? []), node]);
      }
    }
  }
  return drawn;
}

/** One node a guest document draws, with the little a host's selector could test it against. */
interface GuestNode {
  file: string;
  node: Json;
  /**
   * The part names of the element this one sits inside, or `undefined` for the guest's root: that
   * one's parent is the host's own mount box, so a rule reaching it cannot be ruled out.
   */
  parentParts: readonly string[] | undefined;
}

/**
 * Every element a guest document draws, each carrying the parts of the element it sits inside.
 *
 * The nearest enclosing element is the parent whatever the key between them is — `children`, a
 * `$switch` case or a `map` body all render one node inside another.
 *
 * @yields {GuestNode} Each element, the document's own root first.
 */
function* guestNodes(
  value: unknown,
  file: string,
  parentParts?: readonly string[],
): Generator<GuestNode> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* guestNodes(item, file, parentParts);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  const element = typeof value["tagName"] === "string";
  if (element) {
    yield { file, node: value, parentParts };
  }
  const inside = element ? partsOf(value) : parentParts;
  for (const [key, child] of Object.entries(value)) {
    if (key !== "style") {
      yield* guestNodes(child, file, inside);
    }
  }
}

/**
 * The compounds of one selector member, each with the combinator that precedes it.
 *
 * `[` … `]` is opaque, so a bracketed value carrying a space or a `>` does not split a compound.
 */
function sequence(member: string): { combinator: string; compound: string }[] {
  const out: { combinator: string; compound: string }[] = [];
  let combinator = "";
  let compound = "";
  let depth = 0;
  for (const char of member) {
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
    }
    if (depth === 0 && /[\s>+~]/.test(char)) {
      if (compound !== "") {
        out.push({ combinator, compound });
        combinator = "";
        compound = "";
      }
      if (char !== " " || combinator === "") {
        combinator = char === " " ? " " : char;
      }
      continue;
    }
    compound += char;
  }
  if (compound !== "") {
    out.push({ combinator, compound });
  }
  return out;
}

/**
 * Whether a host's compound could match a guest's node at all.
 *
 * The part name has already matched; what is left is every OTHER thing the compound asks for. A tag
 * the node is not, a `[data-…]` it does not carry, a class it has no `class` for: each of those is
 * the rule saying it means a node of the host's own, which is how a host keeps a shared part name
 * without reaching into its guest. Pseudo-classes are ignored — they are state, not identity.
 */
function compoundCouldMatch(compound: string, node: Json): boolean {
  const attributes = isObject(node["attributes"]) ? node["attributes"] : {};
  const tag = /^[a-z][a-z0-9-]*/.exec(compound)?.[0];
  if (tag !== undefined && tag !== node["tagName"]) {
    return false;
  }
  for (const match of compound.matchAll(
    /\[([a-zA-Z-]+)(?:[~^$*|]?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g,
  )) {
    const name = match[1] ?? "";
    const value = match[2] ?? match[3] ?? match[4];
    if (name === "part") {
      continue;
    }
    if (!(name in attributes)) {
      return false;
    }
    if (value !== undefined && String(attributes[name]) !== value) {
      return false;
    }
  }
  const classes = String(attributes["class"] ?? "").split(/\s+/);
  for (const match of compound.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (!classes.includes(match[1] ?? "")) {
      return false;
    }
  }
  return true;
}

/**
 * Whether one selector member could match `guest`.
 *
 * Only the two tests a document can answer: the compound that carries the part name, and — when the
 * part is reached through a CHILD combinator — whether the guest's own parent could be the compound
 * before it. An ancestor combinator says nothing, because the host's box really is the guest's
 * ancestor. The guest's root has no parent here (the host's mount box is), so a rule on it stands.
 */
function memberCouldMatch(member: string, part: string, guest: GuestNode): boolean {
  const seq = sequence(member);
  const at = seq.findIndex(({ compound }) =>
    [...compound.matchAll(PART_SELECTOR)].some(
      (match) => (match[1] ?? match[2] ?? match[3] ?? "") === part,
    ),
  );
  if (at === -1 || !compoundCouldMatch(seq[at]!.compound, guest.node)) {
    return false;
  }
  const parent = at > 0 && seq[at]!.combinator === ">" ? seq[at - 1]!.compound : undefined;
  if (parent === undefined || guest.parentParts === undefined) {
    return true;
  }
  const wanted = [...parent.matchAll(PART_SELECTOR)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  return wanted.every((name) => guest.parentParts!.includes(name));
}

describe("the reserved names are the kit's own", () => {
  test("the permanent live region is `error`, and the derivation cannot silently go empty", () => {
    expect(RESERVED.has("error")).toBe(true);
  });

  test("every field that draws the region is an anchor, including the one that embeds it", () => {
    for (const tag of ["jx-textfield", "jx-select", "jx-combobox", "jx-color-field"]) {
      expect(HOLDERS.has(tag)).toBe(true);
    }
    /* A kit element that merely CONTAINS content is not an anchor: `jx-dialog [part="error"]` is
       a banner rule inside a dialog, and it reaches a field in that dialog like any other. */
    expect(HOLDERS.has("jx-dialog")).toBe(false);
  });
});

describe("the walker sees every rule a style block emits", () => {
  const RESERVED_HERE = new Set(["error"]);
  const HOLDERS_HERE = new Set(["jx-textfield"]);
  const found = (style: Json) =>
    [...selectorsOf(style, "SCOPE")].flatMap((selector) =>
      collisions(selector, RESERVED_HERE, HOLDERS_HERE),
    );

  test("a nested at-rule block, a nested `&` block and a comma list", () => {
    const style: Json = {
      '& [part="row"]': { color: "red", "& [part='error']": { padding: "6px" } },
      "@(forced-colors: active)": { '& [part~="error"]': { border: "1px solid CanvasText" } },
      '& [part="help"], & [part=error]:empty': { margin: "0" },
    };
    expect(found(style)).toEqual([
      "SCOPE [part=\"row\"] [part='error']",
      'SCOPE [part~="error"]',
      "SCOPE [part=error]:empty",
    ]);
  });

  test("an anchor on the kit element that holds the region is not a collision", () => {
    const style: Json = {
      '& jx-textfield [part="error"]': { color: "red" },
      "& jx-textfield": { '& > [part="error"]': { margin: "0" } },
      '& jx-dialog [part="error"]': { margin: "0" },
      '& [part="error-card"], & [part="failure"]': { margin: "0" },
    };
    expect(found(style)).toEqual(['SCOPE jx-dialog [part="error"]']);
  });

  test("a document's node-level style blocks are read as well as its root's", () => {
    const doc: Json = {
      tagName: "section",
      style: { color: "red" },
      children: [{ tagName: "div", style: { '& [part="error"]': { margin: "0" } } }],
    };
    expect([...documentSelectors(doc)]).toEqual(['NODE [part="error"]']);
  });
});

describe("Studio names its own refusals something the kit does not use", () => {
  test.each(SOURCES)("%s", (path) => {
    const doc = read(path);
    const selectors = [...documentSelectors(doc)].flatMap((selector) =>
      collisions(selector, RESERVED, HOLDERS),
    );
    const nodes = [...elementsUnder(doc)]
      .flatMap((node) => partsOf(node))
      .filter((part) => RESERVED.has(part));
    const hint = "name your own banner `failure` or `section-error`";
    expect({ nodes, selectors }, `${path}: ${hint}`).toEqual({ nodes: [], selectors: [] });
  });

  test.each(SHEETS)("%s", (path) => {
    /* The linked sheets have no scope of their own, so a part-name selector in one reaches the
       kit's live region inside every panel and dialog it matches. */
    const selectors = [...sheetSelectors(readFileSync(join(STUDIO, path), "utf8"))].flatMap(
      (selector) => collisions(selector, RESERVED, HOLDERS),
    );
    const hint = 'anchor on the field (`jx-textfield [part="error"]`) or rename the rule';
    expect(selectors, `${path}: ${hint}`).toEqual([]);
  });

  test("the sheet scan reads a nested block, an at-rule and a comma list", () => {
    const css = `
      /* [part="error"] in a comment is not a rule */
      .panel-footer [part="error"] { padding: 6px }
      @media (min-width: 40em) {
        .a [part='error'], .b { margin: 0 }
      }
      .c { color: red; & jx-textfield [part="error"] { color: blue } }
    `;
    expect([...sheetSelectors(css)]).toEqual([
      '.panel-footer [part="error"]',
      ".a [part='error'], .b",
      ".c",
      '& jx-textfield [part="error"]',
    ]);
    const found = [...sheetSelectors(css)].flatMap((selector) =>
      collisions(selector, new Set(["error"]), new Set(["jx-textfield"])),
    );
    expect(found).toEqual(['.panel-footer [part="error"]', ".a [part='error']"]);
  });
});

describe("a surface that hosts an island does not style its guest's parts", () => {
  /* An island is a box in the host's own light DOM, so every descendant part selector the host
     writes reaches the mounted document too. A guest therefore qualifies its part names — the
     managed-connect refusal is `connect-failure`, not the `failure` every panel banner uses,
     because `new-project.json` styles `[part="failure"]` with a border and padding of its own. */
  test.each(Object.entries(ISLAND_GUESTS))("%s", (host, guests) => {
    const doc = read(`src/surfaces/${host}`);
    expect(mountBoxes(doc).length, `${host} draws no island`).toBeGreaterThan(0);
    const guestParts = drawnParts(guests);
    const reached = [...documentSelectors(doc)]
      .flatMap((selector) => splitSelectorList(selector))
      .flatMap((member) =>
        [...member.matchAll(PART_SELECTOR)]
          .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
          .flatMap((name) =>
            (guestParts.get(name) ?? [])
              .filter((guest) => memberCouldMatch(member, name, guest))
              .map((guest) => `${member} reaches [part="${name}"] in ${guest.file}`),
          ),
      );
    const hint =
      "qualify the rule (a child of your own part, an attribute the guest lacks) or the guest's part name, as `connect-failure` does";
    expect([...new Set(reached)], `${host}: ${hint}`).toEqual([]);
  });

  test("every island a host NAMES is listed, so a new body cannot arrive unguarded", () => {
    /* One direction only, and it is the direction that cannot rot: a document that names a box
       `island` has to appear above. The other direction is the test before this one, which fails
       when a listed host stops drawing a mount box at all. Equality would be the wrong shape now
       that `preferences.json` is listed for two boxes it calls `-slot`. */
    const named = SOURCES.filter((path) => path.startsWith("src/surfaces/")).filter((path) =>
      [...elementsUnder(read(path))]
        .flatMap((node) => partsOf(node))
        .some((part) => part === "island" || part.endsWith("-island")),
    );
    const listed = Object.keys(ISLAND_GUESTS).map((name) => `src/surfaces/${name}`);
    for (const host of named) {
      expect(listed, `${host} draws an island and is not in ISLAND_GUESTS`).toContain(host);
    }
  });

  test("a rule is judged against the guest's own node, not just against the name", () => {
    /* A shared part name is not yet a collision, and a guest is not made to rename every word a
       host also uses: what decides it is whether the host's rule could match the guest's NODE.
       Both of Preferences' rules are here, in the two shapes — before and after — because it is
       the only reason the sheet may keep `title` for its heading and `key` for a binding row. */
    const field: GuestNode = {
      file: "ai-credentials-form.json",
      node: { attributes: { part: "key" }, tagName: "jx-textfield" },
      parentParts: ["ai-creds-form"],
    };
    expect(memberCouldMatch('SCOPE [part="key"]', "key", field)).toBe(true);
    expect(memberCouldMatch('SCOPE [part="key"][data-command]', "key", field)).toBe(false);
    const title: GuestNode = {
      file: "ai-credentials-form.json",
      node: { attributes: { part: "title" }, tagName: "div" },
      parentParts: ["ai-creds-form"],
    };
    expect(memberCouldMatch('SCOPE [part="title"]', "title", title)).toBe(true);
    expect(memberCouldMatch('SCOPE [part="section"] > [part="title"]', "title", title)).toBe(false);
    // An ANCESTOR combinator rules nothing out: the host's box really is the guest's ancestor.
    expect(memberCouldMatch('SCOPE [part="section"] [part="title"]', "title", title)).toBe(true);
    // A tag, and a class, the node does not have.
    expect(memberCouldMatch('SCOPE h3[part="title"]', "title", title)).toBe(false);
    expect(memberCouldMatch('SCOPE [part="title"].sheet-heading', "title", title)).toBe(false);
    // The guest's ROOT is the one node whose parent IS the host's box, so a child rule stands.
    const root: GuestNode = {
      file: "ai-credentials-form.json",
      node: { attributes: { part: "ai-creds-form" }, tagName: "div" },
      parentParts: undefined,
    };
    expect(
      memberCouldMatch('SCOPE [part="creds-slot"] > [part="ai-creds-form"]', "ai-creds-form", root),
    ).toBe(true);
  });

  test("a guest node's parent is the nearest element above it, through a case or a map", () => {
    const doc: Json = {
      attributes: { part: "root" },
      children: [
        {
          attributes: { part: "slot" },
          cases: { true: { attributes: { part: "banner" }, tagName: "p" } },
          tagName: "div",
        },
      ],
      tagName: "div",
    };
    const nodes = [...guestNodes(doc, "g.json")];
    expect(nodes.map((node) => partsOf(node.node))).toEqual([["root"], ["slot"], ["banner"]]);
    expect(nodes.map((node) => node.parentParts)).toEqual([undefined, ["root"], ["slot"]]);
  });

  test("the compound scan reads a bracketed value that holds a space or a combinator", () => {
    expect(sequence('[part="a b"] > [data-x="p > q"]')).toEqual([
      { combinator: "", compound: '[part="a b"]' },
      { combinator: ">", compound: '[data-x="p > q"]' },
    ]);
  });
});
