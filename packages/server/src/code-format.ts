/**
 * How the code a document holds is formatted: a function body (`spec.md` §23.1) and a document's
 * script (§23.2), by `oxfmt`, as TypeScript, at its defaults. Studio's code editor and `jx format`
 * both ask here, so a body one of them has formatted is one the other leaves alone.
 *
 * A body is the statements of a function and no file of its own, so it is formatted inside one and
 * taken back out. Taking it out is unindenting it, and a line the formatter did not write must not
 * be unindented: the lines of a template literal are the string's own text. So a body is formatted
 * at two depths, and a line is the formatter's where the deeper reading moved it.
 *
 * @docs framework/build/cli
 * @docs studio/logic/code
 */
import { format } from "oxfmt";

/** One formatting of one piece of code. */
export interface FormattedCode {
  /** The code formatted, or as it was given where it could not be. */
  code: string;
  /** Why it could not be, which is nothing where it could. */
  errors: string[];
}

/** The columns a line of code may take, counted from where the code starts and not the file. */
const COLUMNS = 100;

/** What one level of nesting adds to a line. */
const INDENT = "  ";

/**
 * What a body is wrapped in, so it may `return`. `async`, as a class method that awaits is: whether
 * a body may await is its checker's to say, and a formatter that refused would leave it
 * unformatted.
 */
const OPEN = "async function __jx_fn__() {\n";

/** What the formatter says is wrong with a file. */
type FormatError = Awaited<ReturnType<typeof format>>["errors"][number];

/** What is wrong, and the line of the code it is on where the formatter gives it a place. */
function told(error: FormatError, text: string, placing: Placing): string {
  const at = error.labels[0]?.start;
  if (at === undefined) {
    return error.message;
  }
  // The place is counted in bytes of UTF-8, and a line break is one of those in any text.
  const line = Buffer.from(text).subarray(0, at).toString().split("\n").length - placing.above;
  // Code that stops short is found wrong where the file goes on, which is its own last line.
  return `${error.message} (line ${Math.min(line, placing.lines)})`;
}

/** Where code is in the file it is formatted as. */
interface Placing {
  /** The lines of the file above the code, which a line number in the code does not count. */
  above: number;
  /** The lines the code has. */
  lines: number;
  /** The columns the file's nesting takes, which every line is allowed over {@link COLUMNS}. */
  room: number;
}

/** Format a `.ts` file's text. */
async function formatted(name: string, text: string, placing: Placing): Promise<FormattedCode> {
  const { code, errors } = await format(name, text, {
    printWidth: COLUMNS + placing.room,
    tabWidth: INDENT.length,
    useTabs: false,
  });
  return { code, errors: errors.map((error) => told(error, text, placing)) };
}

/**
 * A body inside its function, with `blocks` blocks around it. Each level is given back the columns
 * it takes, so a line breaks where it would at no depth at all.
 */
async function nested(body: string, blocks: number): Promise<FormattedCode> {
  const text = `${OPEN}${"{\n".repeat(blocks)}${body}\n${"}\n".repeat(blocks)}}\n`;
  const above = 1 + blocks;
  const placing = { above, lines: body.split("\n").length, room: INDENT.length * above };
  const { code, errors } = await formatted("body.ts", text, placing);
  const lines = code.split("\n");
  // The function's line and each block's come off the front, and their braces and the last newline
  // Off the end.
  return { code: lines.slice(above, -(above + 1)).join("\n"), errors };
}

/** One line of a body with its nesting taken off, or null where the two readings disagree. */
function unindented(line: string, deeper: string | undefined): string | null {
  if (deeper === line) {
    // Not moved by a level of nesting, so not the formatter's to indent: a template literal's text.
    return line;
  }
  return deeper === `${INDENT}${line}` && line.startsWith(INDENT)
    ? line.slice(INDENT.length)
    : null;
}

/**
 * Format a function body.
 *
 * @param body The body as written.
 * @returns The body formatted. As written, with why, where it does not parse, and as written with
 *   nothing to say where its lines cannot be told from a string's.
 */
export async function formatBody(body: string): Promise<FormattedCode> {
  if (body.trim() === "") {
    return { code: "", errors: [] };
  }
  const [shallow, deep] = await Promise.all([nested(body, 0), nested(body, 1)]);
  if (shallow.errors.length > 0) {
    return { code: body, errors: shallow.errors };
  }
  const deeper = deep.code.split("\n");
  const lines = shallow.code.split("\n").map((line, at) => unindented(line, deeper[at]));
  const kept = lines.flatMap((line) => (line === null ? [] : [line]));
  const agreed = kept.length === lines.length && deeper.length === lines.length;
  return { code: agreed ? kept.join("\n") : body, errors: [] };
}

/**
 * Format a document's script, which is a module.
 *
 * @param script The module as written.
 * @returns The module formatted, without the newline a file ends with, which a string has no use
 *   for. As written, with why, where it does not parse.
 */
export async function formatScript(script: string): Promise<FormattedCode> {
  if (script.trim() === "") {
    return { code: "", errors: [] };
  }
  const placing = { above: 0, lines: script.trimEnd().split("\n").length, room: 0 };
  const { code, errors } = await formatted("script.ts", script, placing);
  return errors.length > 0 ? { code: script, errors } : { code: code.replace(/\n$/u, ""), errors };
}
