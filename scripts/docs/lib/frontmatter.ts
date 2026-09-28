/**
 * The leading YAML frontmatter block of a Markdown file, split from its body.
 *
 * The docs gates each carry their own copy of the same regex and `Bun.YAML.parse` call
 * (`check-doc-refs.ts`, `check-doc-sync.ts`, `build-llm-export.ts`), and each swallows a parse
 * error as "no frontmatter". A plan whose frontmatter does not parse is not a plan without one, so
 * this version says which it is.
 */

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

export interface Frontmatter {
  /** The parsed mapping; an empty block parses to `{}`. */
  data: Record<string, unknown>;
  /** Everything after the closing `---`. */
  body: string;
  /** The 1-based source line the body starts on. */
  bodyLine: number;
}

export type FrontmatterResult =
  | { kind: "absent"; body: string }
  | { kind: "invalid"; error: string; body: string; bodyLine: number }
  | ({ kind: "parsed" } & Frontmatter);

/** Split `source` into its frontmatter and body. Never throws. */
export function splitFrontmatter(source: string): FrontmatterResult {
  const match = source.match(FRONTMATTER);
  if (!match) {
    return { kind: "absent", body: source };
  }
  const body = source.slice(match[0].length);
  const bodyLine = match[0].split("\n").length - (match[0].endsWith("\n") ? 0 : 1);
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(match[1]!);
  } catch (error) {
    return {
      kind: "invalid",
      error: error instanceof Error ? error.message : String(error),
      body,
      bodyLine,
    };
  }
  if (parsed === null || parsed === undefined) {
    return { kind: "parsed", data: {}, body, bodyLine };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "invalid", error: "frontmatter is not a mapping", body, bodyLine };
  }
  return { kind: "parsed", data: parsed as Record<string, unknown>, body, bodyLine };
}
