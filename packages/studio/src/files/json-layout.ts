/**
 * A JSON document's layout — the facts about a file's text that `JSON.parse` throws away and a save
 * has to put back.
 *
 * Studio's native JSON branch used to be `JSON.stringify(document, null, 2)`, and that is not the
 * layout the repository is kept in. The formatter (`oxfmt`, Prettier-compatible for JSON) keeps a
 * short object on the one line its author wrote it on, so every
 * `packages/studio/src/surfaces/*.json` and `packages/ui/components/*.json` — files Studio now
 * opens as projects — carries hundreds of `{ "part": "bar" }`s that a save expanded to three lines
 * each. One edit became a whole-file diff, and the line the author actually changed was buried in
 * it (issue 308).
 *
 * Two halves. {@link deriveJsonLayout} reads the source text once, when a file is read into a tab,
 * and records the things the formatter would preserve; {@link serializeJson} writes a document back
 * with those facts honoured and everything else laid out the way the formatter lays it out. The
 * test that proves the pair is byte-identity over every formatted document in this repository.
 *
 * **What is recorded, and why nothing else.** The formatter preserves three authored choices and
 * relays everything else. (1) Whether an object's `{` is followed by a line break: an object
 * written on one line stays on one line while it fits the print width, and one whose first key sits
 * on its own line stays expanded however short it is. (2) A blank line between two members of an
 * object or an array — one, however many were written, and never one against a bracket. (3) A
 * non-ASCII character an author spelt as a `\uXXXX` escape, which `JSON.stringify` would otherwise
 * turn into the literal character and so touch a line the edit never reached. Arrays are relaid
 * from scratch every time — `[\n 1, 2 ]` comes back as `[1, 2]` — so an array's own line break is a
 * fact the serializer would then have to ignore, and it is not recorded.
 *
 * **Keyed by JSON Pointer**, so the record survives every edit that leaves a node where it was: a
 * changed value, a new sibling, a removed one. An object with no entry — one the edit created —
 * takes its parent's answer, so a new `{ "$ref": … }` inside an inline `attributes` lands inline
 * beside its siblings rather than blowing the object open; at an expanded level, or in a document
 * that has no layout at all, it expands, which is what the formatter does with `JSON.stringify`
 * output.
 *
 * The width rules are measured against `oxfmt`, not recalled from Prettier: a container is inline
 * when the whole line, trailing comma included, is at most `printWidth` columns; a container with
 * an expanded object or a blank line anywhere inside it expands (a break propagates outward); an
 * array of two or more elements that are all objects with more than one key, or all arrays with
 * more than one element, always expands one element per line; and an array of two or more numbers
 * fills its lines instead of taking one per line. Width is DISPLAY width, as the formatter measures
 * it, not string length: a CJK or fullwidth character and an emoji are two columns, a combining
 * mark or a format character is none ({@link displayWidth}; probed against oxfmt, which uses the
 * `unicode-width` tables — the ranges here are Prettier's, and agree with those on everything a
 * document is likely to hold). Scalars are `JSON.stringify`'s, so `1e5` reads back as `100000` and
 * `1.50` as `1.5` — the parsed value has already lost the spelling, and no document in this
 * repository writes a number either way. `package.json` is the one file the formatter lays out as
 * `JSON.stringify` does, every array expanded; it is not a document and nothing here writes one.
 *
 * @docs studio/interface/tabs
 */

/** A JSON Pointer (RFC 6901) segment: `~` and `/` are the two characters that need escaping. */
function segment(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * What a source text said about its own layout, by JSON Pointer.
 *
 * `inline` maps an object to whether its `{` and first key shared a line; an empty object has no
 * entry because `{}` is `{}` either way. `blankAfter` holds the members a blank line followed.
 * `escaped` maps a string to the UTF-16 code units its source spelt as `\uXXXX` — the units rather
 * than a flag, because `"— Julio Cortázar"` with only the dash escaped is a string this repository
 * holds, and a flag would have had to choose which half of it to rewrite.
 */
export interface JsonLayout {
  inline: Map<string, boolean>;
  blankAfter: Set<string>;
  escaped: Map<string, Set<number>>;
}

/** The print width the repository formats to — `.oxfmtrc.json` leaves oxfmt's default in place. */
export const JSON_PRINT_WIDTH = 100;

/**
 * Read the layout facts out of a JSON text.
 *
 * A scanner rather than a parser: the text has already been through `JSON.parse` by the time this
 * runs (see {@link parseJsonDocument}), so it is known to be well-formed and the scanner only has to
 * find its way from one container to the next. Keys are decoded with `JSON.parse` so the pointer
 * matches the key the document actually holds, escapes and all.
 */
export function deriveJsonLayout(text: string): JsonLayout {
  const layout: JsonLayout = { blankAfter: new Set(), escaped: new Map(), inline: new Map() };
  let i = 0;

  /** Skip whitespace; report how many line breaks were among it. */
  const space = (): number => {
    let newlines = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\n") {
        newlines += 1;
      } else if (c !== " " && c !== "\t" && c !== "\r") {
        break;
      }
      i += 1;
    }
    return newlines;
  };

  /** Consume the string starting at `i`; return its raw text and the code units it escaped. */
  const string = (): { raw: string; escaped: Set<number> } => {
    const start = i;
    const escaped = new Set<number>();
    i += 1;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") {
        if (text[i + 1] === "u") {
          const unit = Number.parseInt(text.slice(i + 2, i + 6), 16);
          if (unit >= 0x80) {
            escaped.add(unit);
          }
          i += 6;
        } else {
          i += 2;
        }
      } else {
        i += 1;
      }
    }
    i += 1;
    return { escaped, raw: text.slice(start, i) };
  };

  /**
   * After a member: consume its separator and note a blank line before the next one. Returns
   * whether the container closed instead.
   */
  const separator = (memberPath: string, close: string): boolean => {
    let newlines = space();
    if (text[i] === close) {
      i += 1;
      return true;
    }
    i += 1; // ","
    newlines += space();
    if (newlines >= 2) {
      layout.blankAfter.add(memberPath);
    }
    return false;
  };

  const value = (path: string): void => {
    space();
    const c = text[i];
    if (c === "{") {
      i += 1;
      const broken = space() > 0;
      if (text[i] === "}") {
        i += 1;
        return;
      }
      layout.inline.set(path, !broken);
      while (i < text.length) {
        const key = JSON.parse(string().raw) as string;
        space();
        i += 1; // ":"
        const member = `${path}/${segment(key)}`;
        value(member);
        if (separator(member, "}")) {
          return;
        }
      }
    } else if (c === "[") {
      i += 1;
      space();
      if (text[i] === "]") {
        i += 1;
        return;
      }
      for (let index = 0; i < text.length; index += 1) {
        const member = `${path}/${index}`;
        value(member);
        if (separator(member, "]")) {
          return;
        }
      }
    } else if (c === '"') {
      const { escaped } = string();
      if (escaped.size > 0) {
        layout.escaped.set(path, escaped);
      }
    } else {
      // A number or a literal: runs to the next delimiter.
      while (i < text.length && !",]} \t\r\n".includes(text[i]!)) {
        i += 1;
      }
    }
  };

  value("");
  return layout;
}

/** Parse a JSON file into the document it holds and the layout it was written in. */
export function parseJsonDocument(text: string): {
  document: Record<string, unknown>;
  layout: JsonLayout;
} {
  const document = JSON.parse(text) as Record<string, unknown>;
  return { document, layout: deriveJsonLayout(text) };
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/** Anything outside printable ASCII: the one case {@link displayWidth} has to count. */
const NOT_ASCII = /[^\u0020-\u007E]/;

/** A mark or a format character (a zero-width joiner, say) takes no column. */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

/** A character the formatter draws two columns wide: East Asian Wide/Fullwidth, or an emoji. */
const EMOJI = /^\p{Emoji_Presentation}$/u;

/**
 * East Asian Wide and Fullwidth (`is-fullwidth-code-point`'s table, which is what Prettier's
 * `getStringWidth` consults): Hangul Jamo, CJK and its punctuation, Hangul syllables, the
 * compatibility ideographs, vertical and small forms, the fullwidth Latin block, and the
 * supplementary ideographic planes.
 */
function isWide(cp: number): boolean {
  return (
    cp >= 0x11_00 &&
    (cp <= 0x11_5f ||
      cp === 0x23_29 ||
      cp === 0x23_2a ||
      (cp >= 0x2e_80 && cp <= 0x32_47 && cp !== 0x30_3f) ||
      (cp >= 0x32_50 && cp <= 0x4d_bf) ||
      (cp >= 0x4e_00 && cp <= 0xa4_c6) ||
      (cp >= 0xa9_60 && cp <= 0xa9_7c) ||
      (cp >= 0xac_00 && cp <= 0xd7_a3) ||
      (cp >= 0xf9_00 && cp <= 0xfa_ff) ||
      (cp >= 0xfe_10 && cp <= 0xfe_19) ||
      (cp >= 0xfe_30 && cp <= 0xfe_6b) ||
      (cp >= 0xff_01 && cp <= 0xff_60) ||
      (cp >= 0xff_e0 && cp <= 0xff_e6) ||
      (cp >= 0x1_b0_00 && cp <= 0x1_b0_01) ||
      (cp >= 0x1_f2_00 && cp <= 0x1_f2_51) ||
      (cp >= 0x2_00_00 && cp <= 0x3_ff_fd))
  );
}

/**
 * How many columns a line of output occupies — what the formatter compares against the print width.
 * `String.length` counts UTF-16 units, and the two part company exactly where a document holds
 * non-Latin text: `"漢"` is one unit and two columns, an emoji is two units and two columns, `"é"`
 * written as `e` plus a combining acute is two units and one column. Measured with the length, a
 * line of CJK could sit "inline" at 62 units and 106 columns, and the formatter would break it open
 * on the next run — a save that is not formatter-stable.
 */
export function displayWidth(text: string): number {
  if (!NOT_ASCII.test(text)) {
    return text.length;
  }
  let width = 0;
  for (const c of text) {
    if (ZERO_WIDTH.test(c)) {
      continue;
    }
    width += isWide(c.codePointAt(0)!) || EMOJI.test(c) ? 2 : 1;
  }
  return width;
}

type Entry = [key: string, value: unknown];

/** Whether `JSON.stringify` would drop this value from an object. */
function omitted(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function entriesOf(value: object): Entry[] {
  return Object.entries(value).filter(([, v]) => !omitted(v));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the formatter forces this array open: two or more elements, all objects with more than
 * one key or all arrays with more than one element (Prettier's "concisely printed" rule,
 * inverted).
 */
function forcedOpen(items: unknown[]): boolean {
  if (items.length < 2) {
    return false;
  }
  const kind = Array.isArray(items[0]) ? "array" : isObject(items[0]) ? "object" : null;
  if (kind === null) {
    return false;
  }
  return items.every((item) =>
    kind === "array"
      ? Array.isArray(item) && item.length > 1
      : isObject(item) && entriesOf(item).length > 1,
  );
}

/** Two or more numbers: the formatter fills lines with them rather than stacking one per line. */
function isNumberRun(items: unknown[]): boolean {
  return items.length > 1 && items.every((item) => typeof item === "number");
}

/** A scalar, as `JSON.stringify` spells it — with the code units the source escaped, escaped. */
function scalar(value: unknown, escaped?: Set<number>): string {
  const text = JSON.stringify(value) ?? "null";
  return escaped === undefined
    ? text
    : text.replaceAll(/[\u0080-\uFFFF]/g, (c) => {
        const unit = c.codePointAt(0)!;
        return escaped.has(unit) ? `\\u${unit.toString(16).padStart(4, "0")}` : c;
      });
}

/**
 * Write a document in the layout the formatter would keep it in.
 *
 * `layout` is what {@link deriveJsonLayout} read from the file this document came from, or `null`
 * for a document that has no file yet (or whose file was not JSON) — every object then expands and
 * every array is laid by fit, which is the formatter's own answer for `JSON.stringify` output. The
 * result ends with exactly one newline, as every formatted file does.
 */
export function serializeJson(
  value: unknown,
  layout: JsonLayout | null,
  printWidth = JSON_PRINT_WIDTH,
): string {
  const inline = layout?.inline ?? new Map<string, boolean>();
  const blankAfter = layout?.blankAfter ?? new Set<string>();
  const escaped = layout?.escaped ?? new Map<string, Set<number>>();

  /**
   * Whether an object is a candidate for one line: its own record, or its parent's when it has
   * none.
   */
  const soft = (path: string, inherited: boolean): boolean => inline.get(path) ?? inherited;

  /**
   * The one-line rendering, or `null` when something inside is forced open — an expanded object, a
   * blank line, or an array the formatter always breaks — so that the break propagates outward the
   * way the formatter's does.
   */
  const flat = (v: unknown, path: string, inherited: boolean): string | null => {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        return "[]";
      }
      if (forcedOpen(v)) {
        return null;
      }
      const parts: string[] = [];
      for (const [index, item] of v.entries()) {
        const member = `${path}/${index}`;
        const part = blankAfter.has(member) ? null : flat(item, member, inherited);
        if (part === null) {
          return null;
        }
        parts.push(part);
      }
      return `[${parts.join(", ")}]`;
    }
    if (isObject(v)) {
      const entries = entriesOf(v);
      if (entries.length === 0) {
        return "{}";
      }
      if (!soft(path, inherited)) {
        return null;
      }
      const parts: string[] = [];
      for (const [key, item] of entries) {
        const member = `${path}/${segment(key)}`;
        const part = blankAfter.has(member) ? null : flat(item, member, true);
        if (part === null) {
          return null;
        }
        parts.push(`${JSON.stringify(key)}: ${part}`);
      }
      return `{ ${parts.join(", ")} }`;
    }
    return scalar(v, escaped.get(path));
  };

  /** Members one per line, with the blank lines the source had between them. */
  const stack = (members: { path: string; text: string }[]): string =>
    members
      .map(({ path, text }, index) =>
        index === members.length - 1 ? text : `${text},\n${blankAfter.has(path) ? "\n" : ""}`,
      )
      .join("");

  /**
   * A value at `column`, followed on its last line by `trailing` more characters (the comma a
   * parent adds, which counts toward the width the formatter measures).
   */
  const render = (
    v: unknown,
    path: string,
    indent: number,
    column: number,
    inherited: boolean,
    trailing: number,
  ): string => {
    const line = flat(v, path, inherited);
    // A scalar is never broken, however long: only a container has a second layout to fall to.
    const container = Array.isArray(v) || isObject(v);
    if (line !== null && (!container || column + displayWidth(line) + trailing <= printWidth)) {
      return line;
    }
    const pad = " ".repeat(indent + 2);
    const close = `\n${" ".repeat(indent)}`;
    if (Array.isArray(v)) {
      if (isNumberRun(v)) {
        const blank = (index: number) => blankAfter.has(`${path}/${index}`);
        return `[\n${fill(v, pad, printWidth, blank)}${close}]`;
      }
      const items = v.map((item, index) => {
        const member = `${path}/${index}`;
        const last = index === v.length - 1;
        const text = render(item, member, indent + 2, pad.length, inherited, last ? 0 : 1);
        return { path: member, text: `${pad}${text}` };
      });
      return `[\n${stack(items)}${close}]`;
    }
    const entries = entriesOf(v as object);
    const own = soft(path, inherited);
    const members = entries.map(([key, item], index) => {
      const member = `${path}/${segment(key)}`;
      const prefix = `${JSON.stringify(key)}: `;
      const last = index === entries.length - 1;
      const at = pad.length + displayWidth(prefix);
      const text = render(item, member, indent + 2, at, own, last ? 0 : 1);
      return { path: member, text: `${pad}${prefix}${text}` };
    });
    return `{\n${stack(members)}${close}}`;
  };

  return `${render(value, "", 0, 0, false, 0)}\n`;
}

/**
 * Numbers packed onto lines greedily: the next one joins the line when it fits with its comma, and
 * opens a new line otherwise. Each line carries `pad`. A blank line the source had after a number
 * (`blank`) ends its line and stays, as it does between any other two members. Lengths, not
 * {@link displayWidth}: a line of numbers and spaces is ASCII, so the two agree.
 */
function fill(
  numbers: unknown[],
  pad: string,
  printWidth: number,
  blank: (index: number) => boolean,
): string {
  const lines: string[] = [];
  let line = "";
  for (const [index, n] of numbers.entries()) {
    const item = `${scalar(n)}${index === numbers.length - 1 ? "" : ","}`;
    if (line === "") {
      line = `${pad}${item}`;
    } else if (line.length + 1 + item.length <= printWidth) {
      line = `${line} ${item}`;
    } else {
      lines.push(line);
      line = `${pad}${item}`;
    }
    if (blank(index) && index < numbers.length - 1) {
      lines.push(line, "");
      line = "";
    }
  }
  lines.push(line);
  return lines.join("\n");
}
