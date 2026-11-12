/**
 * Where a position is in a `.jxn` file that may not parse (`spec.md` §22.6).
 *
 * A completion is asked for while a file is being typed, and `button onclick=` is not KDL, so the
 * parser has nothing to say about the one moment that matters. This is a reading of its own: it
 * keeps to the notation's lexical rules (strings, raw strings, comments, blocks) and gives up at no
 * error. A string left open ends at its line, a block left open ends with the file, and a character
 * that belongs nowhere is stepped over.
 *
 * It answers two things. The nodes of the file, each with its name, its annotation, the values of
 * its line and its block, which is enough to say how `spec.md` §22.1 reads each one. And the
 * position: which node's line or block it is in, and whether a name, a value or an annotation is
 * what would be typed there.
 */
import type { JxnSpan } from "./errors.ts";

/** One value of a node's line, named or alone. */
export interface OutlineEntry {
  /** The annotation written before the value, without its parentheses, or null. */
  annotation: string | null;
  /** The name before `=`, or null for a value written alone. */
  key: string | null;
}

/** One node, as far as it is written. */
export interface OutlineNode {
  /** The annotation written before the name, without its parentheses, or null. */
  annotation: string | null;
  /** The nodes of its block, or null where it has none. */
  children: OutlineNode[] | null;
  entries: OutlineEntry[];
  /** The name as written, without the quotes of a quoted one. Empty while none is written. */
  name: string;
}

/** What would be typed at a position. */
export type OutlineSlot = "annotation" | "entry" | "name" | "value";

/**
 * A position something can be offered at. Its span is the text an offer replaces: the word the
 * position is in, the inside of the string it is in, or nothing.
 */
export interface OutlineCursor extends JxnSpan {
  /**
   * The value the position is in or annotates, or the name it is in. Null for the name of a node,
   * and for a place on a node's line where nothing is written yet.
   */
  entry: OutlineEntry | null;
  /** The node whose line the position is on. Null in a block, where no node is begun. */
  node: OutlineNode | null;
  /** The nodes whose blocks hold the position, outermost first. */
  path: OutlineNode[];
  /** Whether the position is inside a quoted string, so an offer is the text of one. */
  quoted: boolean;
  /**
   * `name` is a node's name, `entry` a name or a lone value on a node's line, `value` what follows
   * `name=` or the inside of a string, and `annotation` the word between parentheses.
   */
  slot: OutlineSlot;
}

/** A file as far as it can be read, and the position asked about. */
export interface Outline {
  /** Null where nothing is offered: in a comment, in code, or after something already closed. */
  cursor: OutlineCursor | null;
  /** The file's top-level nodes. */
  nodes: OutlineNode[];
}

/** What a name is made of: anything the notation gives no other meaning. */
const NAME_CHAR = /[^\s\\/(){};[\]"#=]/u;

/** Space that does not end a line. */
const INLINE_SPACE = /[^\S\n]/u;

/** A string as it was read. */
interface StringToken extends JxnSpan {
  /** One past the last character of its text: where its closing quote is, or would be. */
  inside: number;
  /** Whether it is one quoted line, which is the only kind an offer is made in. */
  plain: boolean;
}

/** One reading of one file. */
class Outliner {
  cursor: OutlineCursor | null = null;
  index: number;
  /** How many slashdashes are being read, each of which comments out what it is read into. */
  muted = 0;
  readonly nodes: OutlineNode[] = [];
  readonly offset: number;
  /** Whether the position has been placed, which happens once. */
  settled = false;
  readonly stack: OutlineNode[] = [];
  readonly text: string;

  constructor(text: string, offset: number) {
    this.text = text;
    this.offset = offset;
    this.index = text.codePointAt(0) === 0xfe_ff ? 1 : 0;
  }

  get char(): string {
    return this.text[this.index] ?? "";
  }

  get done(): boolean {
    return this.index >= this.text.length;
  }

  startsWith(what: string): boolean {
    return this.text.startsWith(what, this.index);
  }

  /** Whether the position is from `start` to `end`, ends included, and not yet placed. */
  holds(start: number, end: number): boolean {
    return !this.settled && this.offset >= start && this.offset <= end;
  }

  /** Place the position. */
  claim(
    slot: OutlineSlot,
    span: JxnSpan,
    node: OutlineNode | null,
    entry: OutlineEntry | null,
    quoted = false,
  ): void {
    // What a slashdash comments out is a comment, and holds the position as one does.
    this.cursor =
      this.muted > 0 ? null : { ...span, entry, node, path: [...this.stack], quoted, slot };
    this.settled = true;
  }

  /** Place the position where nothing is offered, if it is strictly inside `start` to `end`. */
  refuse(start: number, end: number): void {
    if (!this.settled && this.offset > start && this.offset < end) {
      this.settled = true;
    }
  }

  /** Past a `//` comment, which holds the position up to the end of its line. */
  skipLine(): void {
    const start = this.index;
    const end = this.text.indexOf("\n", start);
    this.index = end === -1 ? this.text.length : end;
    this.refuse(start, this.index + 1);
  }

  /** Past a block comment, which nests. */
  skipComment(): void {
    const start = this.index;
    let depth = 1;
    this.index += 2;
    while (!this.done && depth > 0) {
      if (this.startsWith("/*")) {
        depth += 1;
        this.index += 2;
      } else if (this.startsWith("*/")) {
        depth -= 1;
        this.index += 2;
      } else {
        this.index += 1;
      }
    }
    // One left open holds everything after it.
    this.refuse(start, depth > 0 ? this.index + 1 : this.index);
  }

  /** Past what may stand between two values of one line. Answers whether it moved. */
  skipInline(): boolean {
    const start = this.index;
    for (;;) {
      if (INLINE_SPACE.test(this.char)) {
        this.index += 1;
      } else if (this.startsWith("/*")) {
        this.skipComment();
      } else if (this.char === "\\") {
        // A line carried on: the rest of this one is space, and so is its end.
        this.index += 1;
        while (INLINE_SPACE.test(this.char)) {
          this.index += 1;
        }
        if (this.startsWith("//")) {
          this.skipLine();
        }
        this.index += this.startsWith("\n") ? 1 : 0;
      } else {
        return this.index > start;
      }
    }
  }

  /** Past what may stand between two nodes. */
  skipBetween(): void {
    for (;;) {
      if (this.startsWith("//")) {
        this.skipLine();
      } else if (this.char === "\n" || this.char === ";" || this.char === "\u{FEFF}") {
        this.index += 1;
      } else if (!this.skipInline()) {
        return;
      }
    }
  }

  /**
   * Read what the slashdash here comments out: the node, the value or the block after it, which is
   * in no list of the outline and is offered nothing.
   */
  slashdash(read: () => void): void {
    const start = this.index;
    this.index += 2;
    this.muted += 1;
    this.skipBetween();
    read();
    this.muted -= 1;
    this.refuse(start, this.index);
  }

  /** Whether a string begins here: a quote, or the `#`s of a raw one. */
  atString(): boolean {
    return this.char === '"' || /^#+"/u.test(this.text.slice(this.index, this.index + 16));
  }

  /** Read the string that begins here. */
  string(): StringToken {
    const start = this.index;
    while (this.char === "#") {
      this.index += 1;
    }
    const hashes = "#".repeat(this.index - start);
    const lines = this.startsWith('"""');
    const quote = lines ? '"""' : '"';
    this.index += quote.length;
    const close = `${quote}${hashes}`;
    let inside = this.index;
    for (;;) {
      if (this.done || (!lines && this.char === "\n")) {
        inside = this.index;
        break;
      }
      if (this.startsWith(close)) {
        inside = this.index;
        this.index += close.length;
        break;
      }
      // An escape, which a raw string has none of.
      this.index += hashes === "" && this.char === "\\" && !this.startsWith("\\\n") ? 2 : 1;
    }
    this.index = Math.min(this.index, this.text.length);
    return { end: this.index, inside, plain: !lines && hashes === "", start };
  }

  /** Read a string that is a value, and place the position if it is in it. */
  stringValue(node: OutlineNode, entry: OutlineEntry): void {
    const token = this.string();
    if (token.plain && this.holds(token.start + 1, token.inside)) {
      this.claim("value", { end: token.inside, start: token.start + 1 }, node, entry, true);
    }
    // Code, or the far side of a closing quote, where a word would be no part of anything.
    this.refuse(token.start, token.end + 1);
  }

  /** Read the word that begins here, which may be none. */
  word(): JxnSpan {
    const start = this.index;
    while (this.char === "#") {
      this.index += 1;
    }
    while (!this.done && NAME_CHAR.test(this.char)) {
      this.index += 1;
    }
    return { end: this.index, start };
  }

  /** Read the annotation that begins here, and place the position if it is in its word. */
  annotation(node: OutlineNode, entry: OutlineEntry | null): string {
    this.index += 1;
    this.skipInline();
    const word = this.word();
    if (this.holds(word.start, word.end)) {
      this.claim("annotation", word, node, entry);
    }
    this.skipInline();
    this.index += this.char === ")" ? 1 : 0;
    return this.text.slice(word.start, word.end);
  }

  /** Read what follows `name=`, or an annotation, on a node's line. */
  value(node: OutlineNode, entry: OutlineEntry): void {
    if (this.atString()) {
      this.stringValue(node, entry);
      return;
    }
    const word = this.word();
    if (this.holds(word.start, word.end)) {
      this.claim("value", word, node, entry);
    }
  }

  /** Read one value of a node's line. Answers false where what is here is no part of one. */
  entry(node: OutlineNode): boolean {
    const entry: OutlineEntry = { annotation: null, key: null };
    if (this.char === "(") {
      node.entries.push(entry);
      entry.annotation = this.annotation(node, entry);
      this.value(node, entry);
      return true;
    }
    if (this.atString()) {
      node.entries.push(entry);
      this.stringValue(node, entry);
      return true;
    }
    const word = this.word();
    if (word.end === word.start) {
      return false;
    }
    node.entries.push(entry);
    if (this.char !== "=") {
      if (this.holds(word.start, word.end)) {
        this.claim("entry", word, node, entry);
      }
      return true;
    }
    entry.key = this.text.slice(word.start, word.end);
    this.index += 1;
    // A name that already has its `=` is replaced with it, so an offer does not write a second.
    if (this.holds(word.start, word.end)) {
      this.claim("entry", { end: this.index, start: word.start }, node, entry);
    }
    // Asked of the text: the compiler still holds `char` to be the `=` it was before the step.
    if (this.startsWith("(")) {
      entry.annotation = this.annotation(node, entry);
    }
    this.value(node, entry);
    return true;
  }

  /** Read the name of a node, and place the position if it is in it. */
  name(node: OutlineNode): void {
    if (this.atString()) {
      const token = this.string();
      node.name = this.text.slice(
        token.start + (token.inside === token.end ? 0 : token.end - token.inside),
        token.inside,
      );
      this.refuse(token.start, token.end + 1);
      return;
    }
    const word = this.word();
    node.name = this.text.slice(word.start, word.end);
    if (this.holds(word.start, word.end)) {
      this.claim("name", word, node, null);
    }
  }

  /** Read the node that begins here, into the list of its block. */
  node(into: OutlineNode[]): void {
    const node: OutlineNode = { annotation: null, children: null, entries: [], name: "" };
    into.push(node);
    if (this.char === "(") {
      node.annotation = this.annotation(node, null);
      this.skipInline();
    }
    this.name(node);
    for (;;) {
      const before = this.index;
      if (this.skipInline() && this.holds(before + 1, this.index)) {
        this.claim("entry", { end: this.offset, start: this.offset }, node, null);
      }
      if (this.done || this.char === "\n" || this.char === ";" || this.char === "}") {
        return;
      }
      if (this.startsWith("//")) {
        return;
      }
      if (this.char === "{") {
        this.index += 1;
        node.children = [];
        this.stack.push(node);
        this.block(node.children);
        this.stack.pop();
        return;
      }
      if (this.startsWith("/-")) {
        this.slashdash(() => {
          this.commented();
        });
      } else if (!this.entry(node)) {
        this.index += 1;
      }
    }
  }

  /** Read a value or a block that is commented out, into nothing. */
  commented(): void {
    const nowhere: OutlineNode = { annotation: null, children: null, entries: [], name: "" };
    if (this.char === "{") {
      this.index += 1;
      this.stack.push(nowhere);
      this.block([]);
      this.stack.pop();
    } else {
      this.entry(nowhere);
    }
  }

  /** Read nodes into `into` until the block they are in closes, or the file ends. */
  block(into: OutlineNode[]): void {
    for (;;) {
      const before = this.index;
      this.skipBetween();
      if (this.holds(before, this.index)) {
        this.claim("name", { end: this.offset, start: this.offset }, null, null);
      }
      if (this.done) {
        return;
      }
      if (this.char === "}") {
        this.index += 1;
        if (this.stack.length > 0) {
          return;
        }
      } else if (this.startsWith("/-")) {
        this.slashdash(() => {
          this.node([]);
        });
      } else if (this.char === "(" || this.char === "#" || this.atString()) {
        this.node(into);
      } else if (NAME_CHAR.test(this.char)) {
        this.node(into);
      } else {
        // Something that begins nothing: `)`, `=`, a lone `/`.
        this.index += 1;
      }
    }
  }
}

/**
 * Read a `.jxn` file as far as it can be read, and say where a position in it is.
 *
 * @param text The file, which need not parse.
 * @param offset The position, as an offset in `text`.
 * @returns The file's nodes, and the position: null where nothing can be offered at it.
 */
export function outlineJxn(text: string, offset: number): Outline {
  const outliner = new Outliner(text, offset);
  outliner.block(outliner.nodes);
  return { cursor: outliner.cursor, nodes: outliner.nodes };
}
