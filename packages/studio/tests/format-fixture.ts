/**
 * Test fixture: seeds the studio's format host with the parser's Markdown format and provides a
 * platform `formatAction` mock that dispatches to the real implementation in-process (mimicking the
 * dev server's POST /__studio/format).
 */
import { readFileSync } from "node:fs";
import { Markdown } from "@jxsuite/parser/markdown";
import { classDefFrom } from "@jxsuite/schema/format-registry";
import { setFormats } from "../src/format/format-host";
import type { StudioFormat } from "../src/format/format-host";
import type { FormatActionRequest } from "../src/types";
import type { JxDocument } from "@jxsuite/schema/types";

const classUrl = new URL(import.meta.resolve("@jxsuite/parser/Markdown.class.json"));
const classDef = classDefFrom(JSON.parse(readFileSync(classUrl, "utf8")));
const markdownBlock = classDef.format;
if (!markdownBlock) {
  throw new Error("Markdown.class.json declares no format block");
}

const STUDIO_ROLES = new Set(["parse", "serialize", "discover", "load"]);

export const MARKDOWN_FORMAT: StudioFormat = {
  capabilities: Object.fromEntries(
    Object.entries(classDef.$defs?.methods ?? {}).flatMap(([key, m]) =>
      m.role !== undefined && STUDIO_ROLES.has(m.role)
        ? [
            [
              m.role,
              {
                identifier: m.identifier ?? key,
                timing: m.timing ?? ["compiler", "server"],
              },
            ],
          ]
        : [],
    ),
  ),
  documentKinds: markdownBlock.documentKinds ?? [],
  exportTarget: markdownBlock.exportTarget === true,
  extensions: markdownBlock.extensions,
  mediaType: markdownBlock.mediaType ?? null,
  name: "Markdown",
  remote: markdownBlock.remote === true,
  studio: classDef.$studio ?? null,
};

/**
 * The parser's CSV format, hand-built rather than read off its class.
 *
 * It exists to be the format the creation picker and the convert command must EXCLUDE, and for the
 * declared reason rather than by name: `Csv.parse` returns `ContentLoaderEntry[]` rows, so the
 * class declares no `serialize` and only the `content` document kind. Reading it off the class
 * would work today and would stop testing anything the day the class gains a serializer.
 */
export const CSV_FORMAT: StudioFormat = {
  capabilities: {
    discover: { identifier: "discover", timing: ["compiler", "server"] },
    load: { identifier: "load", timing: ["compiler", "server"] },
    parse: { identifier: "parse", timing: ["compiler", "server", "client"] },
  },
  documentKinds: ["content"],
  exportTarget: false,
  extensions: [".csv"],
  mediaType: "text/csv",
  name: "Csv",
  remote: true,
  studio: { icon: "table", modes: ["grid", "source"] },
};

/**
 * A third-party content format that CAN both parse and serialize — the worked TOML example from
 * `specs/extensions.md`.
 *
 * The pair with {@link CSV_FORMAT} is what proves the exclusion rule is about DOCUMENT KINDS and
 * not about capabilities alone: this one has every capability Markdown has and is still not a
 * conversion endpoint, because it declares `content` and never `page` or `component`.
 */
export const TOML_FORMAT: StudioFormat = {
  capabilities: {
    parse: { identifier: "parse", timing: ["compiler", "server", "client"] },
    serialize: { identifier: "serialize", timing: ["compiler", "server", "client"] },
  },
  documentKinds: ["content"],
  exportTarget: false,
  extensions: [".toml"],
  mediaType: "application/toml",
  name: "Toml",
  remote: false,
  studio: null,
};

/** Seed the format host with the Markdown format. */
export function seedMarkdownFormat() {
  setFormats([MARKDOWN_FORMAT]);
}

/** Platform formatAction mock — runs the capability in-process. */
export async function mockFormatAction({
  format,
  action,
  source,
  doc,
  options,
}: FormatActionRequest) {
  if (format !== "Markdown") {
    throw new Error(`Unknown format "${format}"`);
  }
  if (action === "parse") {
    return Markdown.parse(source ?? "");
  }
  if (action === "serialize") {
    /* SAFETY: this stands in for the dev server's POST /__studio/format, which hands the JSON
       body's `doc` and `options` to `Markdown.serialize` as is. The editor's JxMutableNode is that
       same element tree; it differs from JxDocument only by members typed `| undefined`, which JSON
       drops on the real path. `options.mode` is typed `string` on the PAL, but every Studio serialize
       call (serialize-document, convert-file, library-pane) sends `mode: "roundtrip"`, one of the
       two modes the serializer declares. */
    return Markdown.serialize(
      (doc ?? {}) as JxDocument,
      options as Parameters<typeof Markdown.serialize>[1],
    );
  }
  throw new Error(`Unsupported action "${action}"`);
}
