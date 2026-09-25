/**
 * Studio's chrome is not text, and the few places that are text say so by name.
 *
 * `styles/tokens.json` sets `user-select: none` on the root, so a drag across the window highlights
 * no label, button or heading, and restates it on `dialog`, because Chromium's UA sheet gives a
 * MODAL dialog `user-select: text` and every Studio modal is opened with showModal(). What a reader
 * genuinely copies opts back in, one named part at a time, from its own surface document.
 *
 * That makes every selectable region a deliberate decision, and this file is where the decision is
 * written down: it reads every style block Studio authors, nested rules and inline node styles
 * included, and holds the set of places that turn selection back on to the list below EXACTLY. A
 * new selectable part is a one-line, reviewed change here; a surface that quietly reopens selection
 * is a red test naming the file and the rule. Happy-dom does no selection, so the documents are the
 * thing to read. Editable controls need no entry: Chromium keeps an input, a textarea and a
 * contenteditable selectable under an inherited `none`.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { documents as kitDocuments } from "@jxsuite/ui/documents";

type Json = Record<string, unknown>;

/** One place a style block sets `user-select` to something other than `none`. */
type OptIn = readonly [file: string, rule: string, value: string];

const ROOT = resolve(import.meta.dir, "..");
const SURFACES = join(ROOT, "src/surfaces");
const STYLES = join(ROOT, "styles");

/** Every spelling a style block may use for the property, in either case convention. */
const PROPERTIES = new Set([
  "user-select",
  "userSelect",
  "-webkit-user-select",
  "WebkitUserSelect",
  "webkitUserSelect",
]);

/**
 * The whole list. Each entry is a part whose text the reader has to be able to copy and that offers
 * no other way to copy it.
 */
const ALLOWED: readonly OptIn[] = [
  /* The literal request: the message itself in a message dialog, and its island form. The island
     entry names the island's own PROSE, not the island: it is also where the Open Grid picker and
     Push Schema mount whole documents, and `user-select` inherits into them. */
  ["src/surfaces/dialog.json", '& [part="message"]', "text"],
  [
    "src/surfaces/dialog.json",
    '& [part="island"] > p, & [part="island"] > span, & [part="island"] > strong, & [part="island"] > em, & [part="island"] > code',
    "text",
  ],
  // The device code the reader carries to GitHub; `all` selects it whole on one click.
  ["src/surfaces/github-auth.json", '& [part="code"]', "all"],
  // The Assistant's transcript bodies.
  ["src/surfaces/ai-chat.json", '& [part="user-body"]', "text"],
  ["src/surfaces/ai-chat.json", '& [part="md"]', "text"],
  ["src/surfaces/ai-chat.json", '& [part="streaming"]', "text"],
  ["src/surfaces/ai-chat.json", '& [part="import-log"]', "text"],
  // The captured logs a reader pastes into a bug report.
  ["src/surfaces/panel-activity.json", '& [part="log"]', "text"],
  ["src/surfaces/panel-problems.json", '& [part="detail"]', "text"],
  /* About's values and package list: this dialog's body IS its message, and it is the one place a
     bug report's version, commit and resolved `@jxsuite/*` numbers can be read from. */
  ["src/surfaces/about.json", '& [part="meta-value"]', "text"],
  ["src/surfaces/about.json", '& [part="package-row"]', "text"],
];

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every `user-select` a style block declares, with the chain of keys that reaches it.
 *
 * @yields {[string, string]} The rule (its selector keys, space-joined; empty for the block's own
 *   declarations) and the value.
 */
function* declarationsOf(block: Json, rule = ""): Generator<[string, string]> {
  for (const [key, value] of Object.entries(block)) {
    if (PROPERTIES.has(key) && typeof value === "string") {
      yield [rule, value.trim()];
    } else if (isObject(value)) {
      yield* declarationsOf(value, rule === "" ? key : `${rule} ${key}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isObject(item)) {
          yield* declarationsOf(item, rule === "" ? key : `${rule} ${key}`);
        }
      }
    }
  }
}

/**
 * Every style block in a document: the root's own and any node's inline `style`, each with the JSON
 * Pointer that reaches it.
 *
 * @yields {[string, Json]} The block's pointer and the block.
 */
function* styleBlocksOf(value: unknown, pointer = ""): Generator<[string, Json]> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* styleBlocksOf(item, `${pointer}/${index}`);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "style" && isObject(child)) {
      yield [`${pointer}/style`, child];
    } else {
      yield* styleBlocksOf(child, `${pointer}/${key}`);
    }
  }
}

/**
 * Every place a document turns selection on. A rule in the document's own top-level style block is
 * named by its selector alone, which is how the allowlist reads; one anywhere else carries the
 * pointer to its block in front.
 */
function optInsOf(file: string, doc: unknown): OptIn[] {
  const found: OptIn[] = [];
  for (const [pointer, block] of styleBlocksOf(doc)) {
    for (const [rule, value] of declarationsOf(block)) {
      if (value !== "none") {
        found.push([file, pointer === "/style" ? rule : `${pointer} ${rule}`.trim(), value]);
      }
    }
  }
  return found;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/**
 * A source file with its comments removed, so the guards below judge code and not prose.
 *
 * The policy's own rationale is the exact text they scan for: `tokens.json`, the generated
 * `tokens.css` header and `STYLING.md` all explain that Chromium's UA sheet gives a modal dialog
 * `user-select: text`. Written as a JSDoc in any Studio source, that sentence used to read as an
 * inline opt-in and turn this file red. Line comments are cut only where `//` follows whitespace or
 * opens the line, so a `https://` inside a string survives; a string that really does contain ` //
 * ` loses its tail, which costs nothing here because the text is only ever matched against.
 */
const withoutComments = (text: string): string =>
  text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|\s)\/\/[^\n]*/g, "$1");

/** True when a source file's CODE sets `user-select` to anything but `none`. */
const paintsSelectionInline = (source: string): boolean => {
  const text = withoutComments(source);
  return (
    /user-select\s*:\s*(?:text|all|auto|contain)\b/.test(text) ||
    /userSelect\s*(?:=|:)\s*["'`](?:text|all|auto|contain)["'`]/.test(text)
  );
};

const jsonIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .toSorted();

const byKey = (a: OptIn, b: OptIn) => a.join("\0").localeCompare(b.join("\0"));

/** Every `part` a document's nodes carry, split on whitespace. */
function partsOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      partsOf(item, into);
    }
  } else if (isObject(value)) {
    const part = isObject(value["attributes"]) ? value["attributes"]["part"] : undefined;
    if (typeof part === "string") {
      for (const name of part.split(/\s+/).filter(Boolean)) {
        into.add(name);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "style") {
        partsOf(child, into);
      }
    }
  }
  return into;
}

describe("the selection policy", () => {
  test("the root turns selection off, and a modal dialog is told again", () => {
    const tokens = readJson(join(STYLES, "tokens.json")) as { style: Json };
    expect(tokens.style["user-select"]).toBe("none");
    expect((tokens.style["& dialog"] as Json)["user-select"]).toBe("none");
    // The restatement explains itself, because the reason for it is a UA rule nobody can see.
    expect(String((tokens.style["& dialog"] as Json)["$description"])).toContain("showModal()");
  });

  test("only the listed parts turn selection back on, in any surface or stylesheet source", () => {
    const found: OptIn[] = [
      ...jsonIn(SURFACES).flatMap((name) =>
        optInsOf(`src/surfaces/${name}`, readJson(join(SURFACES, name))),
      ),
      ...jsonIn(STYLES).flatMap((name) => optInsOf(`styles/${name}`, readJson(join(STYLES, name)))),
    ];
    expect(found.toSorted(byKey)).toEqual([...ALLOWED].toSorted(byKey));
  });

  test("every listed part is a node its document actually draws", () => {
    /* An allowlist entry whose part was renamed would still pass the equality above while the
       text it was meant to free went back to unselectable, so each one is held to a real node. */
    for (const [file, rule] of ALLOWED) {
      const part = /\[part="([^"]+)"\]/.exec(rule)?.[1];
      expect(part, rule).toBeDefined();
      const drawn = partsOf(readJson(join(ROOT, file)));
      expect([...drawn], `${file} ${rule}`).toContain(part!);
    }
  });

  test("the dialog's message and island are where the opt-in selectors find them", () => {
    const dialog = readJson(join(SURFACES, "dialog.json")) as { children: Json[] };
    const slot = dialog.children.find(
      (child) => (child["attributes"] as Json | undefined)?.["part"] === "message-slot",
    );
    const message = ((slot?.["cases"] as Json | undefined)?.["true"] ?? {}) as Json;
    expect(message["tagName"]).toBe("p");
    expect((message["attributes"] as Json)["part"]).toBe("message");
    const island = dialog.children.find(
      (child) => (child["attributes"] as Json | undefined)?.["part"] === "island",
    );
    expect(island?.["tagName"]).toBe("div");
  });

  test("a document MOUNTED in the island is not the message, and the opt-in cannot reach it", () => {
    /* The island is the message's other form and also a general mount point: the Open Grid picker
       and Push Schema's plan put whole surfaces in it, and those are interface — headings, source
       rows, buttons. `user-select` inherits, so an opt-in on the island itself handed selection to
       every one of them. It names text-level CHILDREN instead, and a mounted document roots a
       `div`, which is what tells the two forms apart. */
    const rule = ALLOWED.find(
      ([file, selector]) =>
        file === "src/surfaces/dialog.json" && selector.includes('[part="island"] >'),
    )!;
    for (const member of rule[1].split(",")) {
      expect(member.trim(), "an island child selector must be text-level").toMatch(
        /> (?:p|span|strong|em|code)$/,
      );
    }
    for (const guest of ["grid-open.json", "push-plan.json"]) {
      expect((readJson(join(SURFACES, guest)) as Json)["tagName"], guest).toBe("div");
    }
  });

  test("no hand-written chrome stylesheet reopens selection", () => {
    /* The linked sheets under `styles/`, generated ones included: a value other than `none` in any
       of them would outrank nothing in a surface but would reopen whole regions of the chrome. */
    const sheets = readdirSync(STYLES).filter((name) => name.endsWith(".css"));
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      const text = withoutComments(readFileSync(join(STYLES, sheet), "utf8"));
      for (const match of text.matchAll(/(?:^|[\s;{])(?:-webkit-)?user-select\s*:\s*([^;}\s]+)/g)) {
        expect(`${sheet}: ${match[1]}`).toBe(`${sheet}: none`);
      }
    }
  });

  test("no TypeScript source paints selection back on inline", () => {
    /* A lit template's `style="user-select: text"` or an element's `style.userSelect = "text"`
       would bypass every surface document above, so the source is read for both spellings. The
       canvas modules are read too: none needs it today, since the canvas document never inherits
       the chrome's `none`, and one that ever does is a reviewed exception written here by name. */
    const offenders: string[] = [];
    const glob = new Bun.Glob("src/**/*.ts");
    for (const path of glob.scanSync({ cwd: ROOT })) {
      if (paintsSelectionInline(readFileSync(join(ROOT, path), "utf8"))) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("a rationale that only describes the policy is not an offender", () => {
    /* The scan above is the one guard whose input is prose as well as code, and the sentence it
       looks for is the sentence the policy is explained with. A source file that says why the
       restatement exists must not read as an opt-in. */
    const jsdoc = `/**\n * Chromium's UA sheet gives a modal dialog \`user-select: text\`, which\n * \`tokens.json\` restates.\n */\nexport const open = () => dialog.showModal();\n`;
    expect(paintsSelectionInline(jsdoc)).toBe(false);
    expect(paintsSelectionInline('// style.userSelect = "text" is what we must never do\n')).toBe(
      false,
    );
    // And the code shapes it exists for are still caught, comments or not.
    expect(paintsSelectionInline(`host.style.userSelect = "text";`)).toBe(true);
    expect(paintsSelectionInline('render(html`<p style="user-select: all">x</p>`);')).toBe(true);
    // A URL is not a line comment, so stripping must not eat the code after one.
    expect(paintsSelectionInline('const doc = "https://x/y"; el.style.userSelect = "text";')).toBe(
      true,
    );
  });

  test("the kit reopens nothing inside Studio either", () => {
    /* Kit elements render in Studio's light DOM, so a kit rule that set `text` would reopen
       selection inside every surface that uses the element. Today the kit only ever turns it off. */
    const found = Object.entries(kitDocuments).flatMap(([tag, doc]) => optInsOf(tag, doc));
    expect(found).toEqual([]);
  });

  test("the canvas document never links the chrome's base, so the author's text stays selectable", () => {
    /* The canvas is its own document for exactly this kind of reason: inline editing and the
       stylebook need selection, and a root rule in `tokens.css` would take it away from them. */
    const canvas = readFileSync(join(ROOT, "canvas.html"), "utf8");
    expect(canvas).not.toContain("tokens.css");
    expect(canvas).not.toMatch(/user-select\s*:\s*none/);
  });
});
