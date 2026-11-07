/**
 * What kind of `.jxn` file this is, without parsing it.
 *
 * A lexical prescan of the first node that is not `$` metadata, which tolerates syntax errors after
 * it. `@bgotink/kdl` throws on the whole of `project "x"\ndefaults {`, and something searching for
 * a project has to be able to tell that that is one, or a typo would make a folder stop being a
 * project.
 */

/** A project file, a document, or something that cannot be read as either. */
export type JxnKind = "document" | "project" | "unreadable";

/** Bytes no text file holds, which is how a binary that happens to be named `.jxn` shows itself. */
const BINARY = /\0/u;

/** Where a node's name can end. */
const NAME = /^[^\s\\/(){};[\]"#=]+/u;

/** The scanner's position in one file. */
class Scanner {
  index: number;
  readonly text: string;

  /** @param text The file. */
  constructor(text: string) {
    this.text = text;
    this.index = text.codePointAt(0) === 0xfe_ff ? 1 : 0;
  }

  get done(): boolean {
    return this.index >= this.text.length;
  }

  startsWith(what: string): boolean {
    return this.text.startsWith(what, this.index);
  }

  /** Past a `//` comment. */
  skipLine(): void {
    const end = this.text.indexOf("\n", this.index);
    this.index = end === -1 ? this.text.length : end;
  }

  /** Past a `/* … *\/` comment, which nests. */
  skipBlock(): void {
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
  }

  /** Past whitespace, comments and `/-` slashdashed nodes. */
  skipTrivia(): void {
    for (;;) {
      while (!this.done && /[\s;]/u.test(this.text.charAt(this.index))) {
        this.index += 1;
      }
      if (this.startsWith("//")) {
        this.skipLine();
      } else if (this.startsWith("/*")) {
        this.skipBlock();
      } else if (this.startsWith("/-")) {
        this.index += 2;
        this.skipNode();
      } else {
        return;
      }
    }
  }

  /**
   * Past a string at the cursor.
   *
   * @returns Whether it was terminated.
   */
  skipString(): boolean {
    let hashes = 0;
    let at = this.index;
    while (this.text.charAt(at) === "#") {
      hashes += 1;
      at += 1;
    }
    const multiline = this.text.startsWith('"""', at);
    const quote = multiline ? '"""' : '"';
    const close = quote + "#".repeat(hashes);
    at += quote.length;
    while (at < this.text.length) {
      if (hashes === 0 && this.text.charAt(at) === "\\") {
        at += 2;
      } else if (this.text.startsWith(close, at)) {
        this.index = at + close.length;
        return true;
      } else if (!multiline && this.text.charAt(at) === "\n") {
        return false;
      } else {
        at += 1;
      }
    }
    return false;
  }

  /**
   * Past a whole node, respecting strings, comments and blocks.
   *
   * @returns Whether its end was found.
   */
  skipNode(): boolean {
    let depth = 0;
    while (!this.done) {
      const char = this.text.charAt(this.index);
      if (
        char === '"' ||
        (char === "#" && /^#+"/u.test(this.text.slice(this.index, this.index + 16)))
      ) {
        if (!this.skipString()) {
          return false;
        }
      } else if (this.startsWith("//")) {
        this.skipLine();
      } else if (this.startsWith("/*")) {
        this.skipBlock();
      } else if (char === "{") {
        depth += 1;
        this.index += 1;
      } else if (char === "}") {
        if (depth === 0) {
          return false;
        }
        depth -= 1;
        this.index += 1;
      } else if ((char === "\n" || char === ";") && depth === 0) {
        this.index += 1;
        return true;
      } else {
        this.index += 1;
      }
    }
    return depth === 0;
  }
}

/**
 * Tell a project file from a document, from the first node that is not `$` metadata.
 *
 * @param text The file.
 */
export function classifyJxn(text: string): JxnKind {
  if (BINARY.test(text)) {
    return "unreadable";
  }
  const scanner = new Scanner(text);
  for (;;) {
    scanner.skipTrivia();
    if (scanner.done) {
      return "document";
    }
    if (scanner.startsWith("(")) {
      const close = text.indexOf(")", scanner.index);
      if (close === -1) {
        return "unreadable";
      }
      scanner.index = close + 1;
    } else {
      const [name] = NAME.exec(text.slice(scanner.index, scanner.index + 256)) ?? [];
      if (!name) {
        // A quoted name is a tag no project node has, and anything else here is not KDL.
        return scanner.startsWith('"') || scanner.startsWith("#") ? "document" : "unreadable";
      }
      if (!name.startsWith("$")) {
        return name === "project" ? "project" : "document";
      }
      scanner.index += name.length;
      if (!scanner.skipNode()) {
        return "unreadable";
      }
    }
  }
}
