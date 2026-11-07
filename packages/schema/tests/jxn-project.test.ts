/**
 * A project file in Jx Notation (`site-architecture.md` §2.3): the grammar, what it refuses, the
 * canonical form, and saving without losing a comment.
 *
 * The property that matters most is the corpus one: every tracked `project.json` written as
 * `project.jxn` reads back deep-equal, with `style`, `$media` and `$head` in their order.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { JsonObject, JsonValue, ProjectConfig } from "../types.ts";
import { isJsonObject } from "../src/guards.ts";
import {
  JxnError,
  classifyJxn,
  parseJxn,
  parseProject,
  parseProjectWithSpans,
  serializeProject,
} from "../src/jxn/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");

/* Written as code points, so the source holds no character that changes how it reads. */
const COMBINING_ACUTE = String.fromCodePoint(0x3_01);
const LINE_SEPARATOR = String.fromCodePoint(0x20_28);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x20_2e);

/** A configuration for the writer, from a literal. */
function asConfig(value: JsonValue): ProjectConfig {
  // SAFETY: every ProjectConfig member is optional, and each test decides what it holds.
  return value as ProjectConfig;
}

/** A project file's configuration, as the JSON it is. */
function read(text: string, path?: string): JsonObject {
  const config: unknown = parseProject(text, path);
  if (!isJsonObject(config)) {
    throw new TypeError("a configuration was expected");
  }
  return config;
}

/** Write, then read back. */
function roundTrip(config: JsonValue): JsonValue {
  return read(serializeProject(asConfig(config)));
}

/** The message a read fails with. */
function refusal(text: string): string {
  try {
    parseProject(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the file was read, and a refusal was expected");
}

const SAMPLE = `/- kdl-version 2
$schema "./project.schema.json"
project "Bistro & Café"

url "https://bistro-cafe.pages.dev"

// The base layout every page inherits unless it names another.
defaults layout="./layouts/base.json" lang=en

// \`connections\` and \`data\` below come from the connector.
extensions "@jxsuite/parser" "@jxsuite/connector"

images {
    optimize #true
    widths 320 640 960 1280 1920
    formats webp avif
    quality webp=80 avif=65 jpeg=80 png=80
}

$head {
    meta name=viewport content="width=device-width, initial-scale=1"
    link rel=icon href="/favicon.svg"
}

$media {
    --md "(max-width: 768px)"
    --dark "(prefers-color-scheme: dark)"
}

style {
    --color-primary "#9a2f1a"
    "@--dark" {
        --color-primary "#e06a50"
    }
}

connections {
    main provider=sqlite file="./data/main.sqlite"
}

data {
    comments {
        connection main
        schema {
            type object
            properties {
                author type=string title=Author
                body type=string title=Comment
            }
            required author body
        }
        // Guests may comment, and only staff may edit or remove one.
        permissions read=public insert=public update=role:staff delete=role:staff
    }
}
`;

describe("the grammar", () => {
  test("the spec's sample reads to the configuration its JSON spelling would", () => {
    expect(read(SAMPLE)).toEqual({
      $head: [
        {
          attributes: { content: "width=device-width, initial-scale=1", name: "viewport" },
          tagName: "meta",
        },
        { attributes: { href: "/favicon.svg", rel: "icon" }, tagName: "link" },
      ],
      $media: { "--dark": "(prefers-color-scheme: dark)", "--md": "(max-width: 768px)" },
      $schema: "./project.schema.json",
      connections: { main: { file: "./data/main.sqlite", provider: "sqlite" } },
      data: {
        comments: {
          connection: "main",
          permissions: {
            delete: "role:staff",
            insert: "public",
            read: "public",
            update: "role:staff",
          },
          schema: {
            properties: {
              author: { title: "Author", type: "string" },
              body: { title: "Comment", type: "string" },
            },
            required: ["author", "body"],
            type: "object",
          },
        },
      },
      defaults: { lang: "en", layout: "./layouts/base.json" },
      extensions: ["@jxsuite/parser", "@jxsuite/connector"],
      images: {
        formats: ["webp", "avif"],
        optimize: true,
        quality: { avif: 65, jpeg: 80, png: 80, webp: 80 },
        widths: [320, 640, 960, 1280, 1920],
      },
      name: "Bistro & Café",
      style: { "--color-primary": "#9a2f1a", "@--dark": { "--color-primary": "#e06a50" } },
      url: "https://bistro-cafe.pages.dev",
    });
  });

  // One row of the grammar's table each: what is written, and what it means.
  const ROWS: [string, string, JsonObject][] = [
    ["project [name]", 'project "A"', { name: "A" }],
    ["a project with no name", "project", {}],
    ["top-level $x nodes", '$schema "./s.json"\nproject', { $schema: "./s.json" }],
    [
      "$head's rows are elements",
      'project\n$head {\n    meta name=robots content=all\n    - (ref)"./head.json"\n}',
      {
        $head: [
          { attributes: { content: "all", name: "robots" }, tagName: "meta" },
          { $ref: "./head.json" },
        ],
      },
    ],
    [
      "style rows, nested",
      'project\nstyle {\n    color red\n    "& a" color=blue\n}',
      { style: { "& a": { color: "blue" }, color: "red" } },
    ],
    [
      "$media rows",
      'project\n$media {\n    --md "(width < 768px)"\n}',
      {
        $media: { "--md": "(width < 768px)" },
      },
    ],
    ["a scalar member", "project\nurl x", { url: "x" }],
    ["an array of many", "project\nextensions a b", { extensions: ["a", "b"] }],
    ["an array of one", "project\nextensions {\n    - a\n}", { extensions: ["a"] }],
    ["an empty array", "project\n(array)extensions", { extensions: [] }],
    ["an object in one line", "project\nbuild a=1 b=2", { build: { a: 1, b: 2 } }],
    ["an object in a block", "project\nbuild {\n    a 1; b 2\n}", { build: { a: 1, b: 2 } }],
    ["an empty object", "project\nbuild {}", { build: {} }],
    [
      "(ref) anywhere a value goes",
      'project\ndefaults layout=(ref)"#/x"',
      {
        defaults: { layout: { $ref: "#/x" } },
      },
    ],
  ];

  for (const [row, text, expected] of ROWS) {
    test(row, () => {
      expect(read(text)).toEqual(expected);
      expect(roundTrip(expected)).toEqual(expected);
    });
  }

  test("$ metadata may also follow the declaration", () => {
    expect(read('project\n$schema "./s.json"')).toEqual({ $schema: "./s.json" });
  });

  test("an annotated $head or style is a JSON block, as the annotation says", () => {
    expect(read("project\n(object)$head a=1\n(array)style")).toEqual({
      $head: { a: 1 },
      style: [],
    });
  });

  test("a project node in a document's place is a project, so pages/project.jxn can be a page", () => {
    const page = 'h1 "About the project"';
    expect(classifyJxn(page)).toBe("document");
    expect(parseJxn(page).tagName).toBe("h1");
    expect(classifyJxn('project "x"')).toBe("project");
  });
});

describe("what a reader refuses", () => {
  test("a file with no project node, naming the fix", () => {
    expect(refusal('url "x"')).toContain(`project "<name>"`);
  });

  test("the node twice", () => {
    expect(refusal('project "a"\nproject "b"')).toContain("written twice");
  });

  test("anything on the node but a name", () => {
    expect(refusal('project "a" "b"')).toContain("one value");
    expect(refusal("project x=1")).toContain("one value");
    expect(refusal("project {\n    a 1\n}")).toContain("one value");
  });

  test("an annotation on the node", () => {
    expect(refusal('(object)project "a"')).toContain("no annotation");
  });

  test("a name given twice", () => {
    expect(refusal('project "a"\nname "b"')).toContain(`"name" is written twice`);
  });

  test("a key written twice after NFC", () => {
    expect(refusal(`project\nbuild café=1 cafe${COMBINING_ACUTE}=2`)).toContain("written twice");
  });

  test("__proto__", () => {
    expect(refusal("project\nbuild __proto__=1")).toContain("__proto__");
  });

  test("KDL's own syntax errors, with a line and column", () => {
    const error = (() => {
      try {
        parseProject('project "a"\ndefaults {', "site/project.jxn");
      } catch (error_) {
        return error_;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(JxnError);
    if (error instanceof JxnError) {
      expect(error.message).toStartWith("site/project.jxn: ");
      expect(error.line).toBe(2);
    }
  });

  test("a document parser refuses a project file, and the project parser a document", () => {
    expect(() => parseJxn('project "a"')).toThrow("project file");
    expect(refusal("div")).toContain("declares itself");
  });

  test("an error without a path is the error itself", () => {
    expect(() => parseProject("project\nproject")).toThrow(JxnError);
  });
});

describe("the writer", () => {
  test("the canonical form: metadata, then the declaration, then a blank line between sections", () => {
    const text = serializeProject(
      asConfig({
        $schema: "./project.schema.json",
        name: "Site",
        url: "https://example.com",
        extensions: ["@jxsuite/parser"],
        $media: { "--": "1200px" },
        style: { color: "red", "& a": { color: "blue" } },
      }),
    );
    expect(text).toBe(`/- kdl-version 2
$schema "./project.schema.json"
project Site

url "https://example.com"

extensions {
    - "@jxsuite/parser"
}

$media {
    -- "1200px"
}

style {
    color red
    "& a" {
        color blue
    }
}
`);
  });

  test("no name is a bare declaration", () => {
    expect(serializeProject(asConfig({}))).toBe("/- kdl-version 2\nproject\n");
  });

  test("a name with no scalar spelling is a member of its own", () => {
    const config = { name: { first: "a" } };
    expect(serializeProject(asConfig(config))).toContain("project\n\nname first=a");
    expect(roundTrip(config)).toEqual(config);
  });

  test("long metadata keeps its own section", () => {
    const config = { $comment: "line one\nline two", $elements: [] };
    const text = serializeProject(asConfig(config));
    expect(text).toStartWith("/- kdl-version 2\nproject\n\n$comment");
    expect(roundTrip(config)).toEqual(config);
  });

  test("a $head that is not a list is annotated, so it is not read as rows", () => {
    const config = { $head: { a: 1 } };
    expect(serializeProject(asConfig(config))).toContain("(object)$head a=1");
    expect(roundTrip(config)).toEqual(config);
  });

  test("a style list, such as several @font-face, keeps its items", () => {
    const config = { style: { "@font-face": [{ fontFamily: "A" }, { fontFamily: "B" }] } };
    expect(roundTrip(config)).toEqual(config);
  });

  test("an empty style is an empty block", () => {
    expect(roundTrip({ style: {} })).toEqual({ style: {} });
  });

  test("a style that is not a set of declarations is refused, naming where", () => {
    expect(() => serializeProject(asConfig({ style: "red" }))).toThrow("/style");
    const media = asConfig({ $media: { $ref: "./m.json" } });
    expect(() => serializeProject(media)).toThrow("/$media");
    expect(() => serializeProject(asConfig([]))).toThrow("is an object");
  });

  test("the canonical form is stable", () => {
    const once = serializeProject(asConfig(read(SAMPLE)));
    const again = asConfig(read(once));
    expect(serializeProject(again)).toBe(once);
  });
});

/** Values that a careless spelling would change, each as a member of `build`. */
const ADVERSARIAL: [string, JsonValue][] = [
  ["a keyword as a string", "true"],
  ["null as a string", "null"],
  ["a number as a string", "1280"],
  ["negative zero", -0],
  ["U+2028", `a${LINE_SEPARATOR}b`],
  ["a newline", "a\nb"],
  ["a raw-string breaker", '"#'],
  ["a backslash", String.raw`a\sb`],
  ["a one-item array", ["a"]],
  ["a nested array", [["a"], []]],
  ["a one-item nested array", [[1]]],
  ["$ref with siblings", { $ref: "./x.json", extra: 1 }],
  ["$ref alone", { $ref: "./x.json" }],
  ["a key of -", { "-": 1 }],
  ["only keys of -", { "-": [1] }],
  ["an empty string", ""],
  ["a string of spaces", "  "],
  ["a key with a space", { "a b": 1 }],
  ["a key that is a number", { "1": "one" }],
  ["a bidirectional control", `a${RIGHT_TO_LEFT_OVERRIDE}b`],
  ["a tab", "a\tb"],
  ["an empty object", {}],
  ["an object in an array", [{ a: 1 }]],
  ["null", null],
  ["a large safe integer", Number.MAX_SAFE_INTEGER],
];

describe("adversarial values survive", () => {
  for (const [what, value] of ADVERSARIAL) {
    test(what, () => {
      const config = { build: { value } };
      expect(roundTrip(config)).toEqual(config);
    });
  }

  test("-0 stays negative", () => {
    const back = read(serializeProject(asConfig({ build: { value: -0 } })));
    expect(isJsonObject(back.build) && Object.is(back.build.value, -0)).toBe(true);
  });
});

describe("saving keeps what did not change", () => {
  /** Parse the sample, change it, write it back against the sample. */
  function edited(change: (config: JsonObject) => void): string {
    const config = read(SAMPLE);
    change(config);
    return serializeProject(asConfig(config), SAMPLE);
  }

  /** The sample with these lines replaced, which is what a confined change looks like. */
  function withLines(replacements: Record<string, string>): string {
    let text = SAMPLE;
    for (const [from, to] of Object.entries(replacements)) {
      expect(text).toContain(from);
      text = text.replace(from, to);
    }
    return text;
  }

  test("nothing changed is the file, byte for byte", () => {
    expect(edited(() => {})).toBe(SAMPLE);
  });

  test("a setting changed in Studio touches its own line", () => {
    const out = edited((config) => {
      config.url = "https://bistro.example";
    });
    expect(out).toBe(
      withLines({ 'url "https://bistro-cafe.pages.dev"': 'url "https://bistro.example"' }),
    );
  });

  test("an extension added touches its own line", () => {
    const out = edited((config) => {
      config.extensions = ["@jxsuite/parser", "@jxsuite/connector", "@jxsuite/search"];
    });
    expect(out).toBe(
      withLines({
        'extensions "@jxsuite/parser" "@jxsuite/connector"':
          'extensions "@jxsuite/parser" "@jxsuite/connector" "@jxsuite/search"',
      }),
    );
  });

  test("a permission removed keeps the comment above it", () => {
    const out = edited((config) => {
      const { data } = config;
      const comments = isJsonObject(data) ? data.comments : null;
      if (isJsonObject(comments)) {
        comments.permissions = { insert: "public", read: "public" };
      }
    });
    expect(out).toBe(
      withLines({
        "permissions read=public insert=public update=role:staff delete=role:staff":
          "permissions read=public insert=public",
      }),
    );
  });

  test("a redirect removed takes its own line and nothing else", () => {
    const source = `/- kdl-version 2
project Site

// Old paths, kept so links in the wild still land.
redirects {
    // From the 2025 site.
    "/old" "/new"
    "/gone" "/"
}
`;
    const config = read(source);
    config.redirects = { "/old": "/new" };
    expect(serializeProject(asConfig(config), source)).toBe(
      source.replace('    "/gone" "/"\n', ""),
    );
  });

  test("a writer holding the members in another order moves none of them", () => {
    const config = read(SAMPLE);
    const { url, ...rest } = config;
    const reordered = { ...rest, url: "https://bistro.example" };
    expect(Object.keys(reordered).at(-1)).toBe("url");
    expect(url).toBe("https://bistro-cafe.pages.dev");
    expect(serializeProject(asConfig(reordered), SAMPLE)).toBe(
      withLines({ 'url "https://bistro-cafe.pages.dev"': 'url "https://bistro.example"' }),
    );
  });

  test("a previous file that does not read is replaced by the canonical form", () => {
    expect(serializeProject(asConfig({ name: "A" }), "project\nproject")).toBe(
      "/- kdl-version 2\nproject A\n",
    );
  });

  test("renaming the project keeps the comments around the declaration", () => {
    const out = edited((config) => {
      config.name = "Bistro";
    });
    expect(out).toBe(withLines({ 'project "Bistro & Café"': "project Bistro" }));
  });

  test("spans say where each part came from", () => {
    const { spans } = parseProjectWithSpans(SAMPLE);
    const at = (pointer: string): string => {
      const span = spans.get(pointer);
      return span ? SAMPLE.slice(span.start, span.end) : "";
    };
    expect(at("/name")).toBe('project "Bistro & Café"');
    expect(at("/$head")).toStartWith("$head {");
    expect(at("/$media/--md")).toBe('--md "(max-width: 768px)"');
    expect(at("/defaults/lang")).toBe("lang=en");
  });
});

/** Every tracked project file. */
function trackedProjectFiles(): string[] {
  return execFileSync("git", ["ls-files", "*project.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((file) => file !== "" && !file.includes("/surfaces/"));
}

/** Every key's order, at every depth, which is what a reader of `style`, `$media`, `$head` sees. */
function ordered(value: JsonValue | undefined): string {
  return JSON.stringify(value ?? null);
}

describe("the corpus", () => {
  test("every tracked project file comes back deep-equal, with style, $media and $head in order", () => {
    const files = trackedProjectFiles();
    for (const file of files) {
      const parsed: unknown = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
      if (!isJsonObject(parsed)) {
        throw new TypeError(`${file} is not an object`);
      }
      const text = serializeProject(asConfig(parsed));
      const back = read(text, file);
      expect([file, back]).toEqual([file, parsed]);
      for (const key of ["style", "$media", "$head"]) {
        expect([file, key, ordered(back[key])]).toEqual([file, key, ordered(parsed[key])]);
      }
      expect([file, serializeProject(asConfig(back))]).toEqual([file, text]);
    }
    // Enough that this cannot pass by finding nothing.
    expect(files.length).toBeGreaterThan(25);
  });
});
