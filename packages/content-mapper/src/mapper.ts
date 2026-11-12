/**
 * The content mapper TypeScript runs for `.jxn` files (`spec.md` §23.3).
 *
 * TypeScript 7.1 can be told that a file it does not read is written by a program that does: a
 * content mapper, which answers each file with the TypeScript it stands for and a map between the
 * two. This is that program's answer for Jx Notation. What a document's types are is not decided
 * here: `@jxsuite/schema/virtual-document` writes the modules, as it does for every other reader,
 * and this hands them to the compiler in the form its protocol takes.
 *
 * What it adds is the one thing a file cannot say about itself: what its project gives it. A page
 * in a project with `state` of its own, or with a default layout, reads state the page never names,
 * so its `State` is open, and only the project file says which. And a document uses the components
 * its project keeps without declaring them, so only the project's folder says what a tag names.
 *
 * @docs framework/concepts/type-checking
 */
import { readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { baseName, isProjectFileName, PROJECT_FILE_NAMES } from "@jxsuite/schema/project-file";
import {
  findEnclosingProjectOnDisk,
  isSameStamp,
  projectFileStamp,
  readProjectFile,
} from "@jxsuite/schema/project-file/node";
import type { EnclosingProject } from "@jxsuite/schema/project-file";
import type { ProjectFileStamp } from "@jxsuite/schema/project-file/node";
import type { JsonObject } from "@jxsuite/schema/types";
import {
  generateVirtualDocument,
  givenByProject,
  outsideAt,
} from "@jxsuite/schema/virtual-document";
import type { OutsideState, ProjectGives, VirtualUnit } from "@jxsuite/schema/virtual-document";
import { SpanMapKind, stringIndexToPosition } from "ts-content-mapper";
import type {
  ContentMapperDefinition,
  MappedOutput,
  PositionEncoding,
  SpanMapping,
} from "ts-content-mapper";

/** The prefix TypeScript puts before a code of ours: `error jx1`. */
export const DIAGNOSTIC_SOURCE = "jx";

/** The file is not Jx Notation, so nothing in it could be read. */
export const NOT_NOTATION = 1;

/** What is remembered between files of one compile. */
export interface MapperProject {
  /** Each project folder met, as its file last read. */
  facts: Map<string, { facts: ProjectGives; stamp: ProjectFileStamp }>;
  /** The folder holding the `tsconfig`, above which no project is looked for. */
  root: string | null;
}

/**
 * A project file that cannot be read gives nothing away, so a document in its folder is assumed to
 * inherit everything: the file's own error is the one to report, not a hundred about `state`.
 */
const UNREADABLE: ProjectGives = { layout: true, state: true };

/** Read what a project gives its documents, from its file as it is now. */
function readFacts(root: string): ProjectGives {
  const read = readProjectFile(root);
  return read === null || "error" in read ? UNREADABLE : givenByProject(read.config);
}

/** What a project gives its documents, read again only when its file has changed. */
function factsOf(root: string, project: MapperProject): ProjectGives {
  const stamp = projectFileStamp(root);
  if (stamp === null) {
    // A folder holding both project files, which no host chooses between.
    return UNREADABLE;
  }
  const cached = project.facts.get(root);
  if (cached && isSameStamp(cached.stamp, stamp)) {
    return cached.facts;
  }
  const facts = readFacts(root);
  project.facts.set(root, { facts, stamp });
  return facts;
}

/** What a project found on disk gives its documents: nothing is known of one that cannot be read. */
function givenBy(found: EnclosingProject, project: MapperProject): ProjectGives {
  return found.verdict === "project" ? factsOf(found.root, project) : UNREADABLE;
}

/**
 * The folders at or under one that hold a file named as a project file is.
 *
 * A `tsconfig` may sit above several projects, and the compiler says which files it reads only as
 * it reads them, so the projects are looked for: in every folder but `node_modules` and one whose
 * name begins with a dot, and through no link.
 *
 * @param root The folder holding the `tsconfig`.
 * @returns Each folder, in the order of their paths.
 */
function projectFoldersUnder(root: string): string[] {
  const found: string[] = [];
  const pending = [root];
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      // A folder that cannot be listed holds no project a document could be read from.
      entries = [];
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        pending.push(join(at, entry.name));
      }
    }
    if (entries.some((entry) => isProjectFileName(entry.name))) {
      found.push(at);
    }
  }
  return found.toSorted();
}

/** A component a project keeps, by its file: a tag, which has a hyphen, and `.jxn`. */
const KEPT_COMPONENT = /^(?<tag>.+-.*)\.jxn$/u;

/**
 * The components a project keeps, which every document of it uses without declaring them
 * (`imports.md` §1.4): each `.jxn` file directly in `components/` that is named for its tag.
 *
 * It is read from the folder each time, and not remembered, because a component is added by writing
 * a file, which nothing here is told of.
 *
 * @param root The project's folder.
 * @param fileName The document they are for.
 * @returns How the document imports each one, by its tag.
 */
function componentsOf(root: string, fileName: string): Record<string, string> {
  const folder = join(root, "components");
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    // A project with no components has no folder for them.
    return {};
  }
  const from = dirname(fileName);
  return Object.fromEntries(
    names.toSorted().flatMap((name) => {
      const tag = KEPT_COMPONENT.exec(name)?.groups?.tag;
      const path = relative(from, join(folder, name)).split(sep).join("/");
      return tag === undefined ? [] : [[tag, path.startsWith(".") ? path : `./${path}`]];
    }),
  );
}

/**
 * What a document is given by the project it is in.
 *
 * @param fileName The document's absolute path.
 * @param project What this compile remembers.
 */
export function outsideOf(fileName: string, project: MapperProject): OutsideState {
  const found = findEnclosingProjectOnDisk(dirname(fileName), project.root ?? undefined);
  if (!found) {
    return {};
  }
  const [folder] = relative(found.root, fileName).split(sep);
  return {
    ...outsideAt(folder, givenBy(found, project)),
    components: componentsOf(found.root, fileName),
  };
}

/** One module in the form the protocol takes, with its offsets in the encoding agreed on. */
function mappedOutput(unit: VirtualUnit, source: string, encoding: PositionEncoding): MappedOutput {
  const mappings: SpanMapping[] = unit.spans.map((span) => {
    const virtualStart = stringIndexToPosition(unit.text, span.virtualStart, encoding);
    const virtualEnd = stringIndexToPosition(
      unit.text,
      span.virtualStart + span.virtualLength,
      encoding,
    );
    const originalStart = stringIndexToPosition(source, span.originalStart, encoding);
    const originalEnd = stringIndexToPosition(
      source,
      span.originalStart + span.originalLength,
      encoding,
    );
    return [
      virtualStart,
      virtualEnd - virtualStart,
      originalStart,
      originalEnd - originalStart,
      span.kind === "verbatim" ? SpanMapKind.Verbatim : SpanMapKind.Atom,
    ];
  });
  return { extension: unit.extension, mappings, text: unit.text };
}

/**
 * What is said of a file no `tsconfig` reads, which an editor opens on its own: nothing a project
 * gives is known before the file is. It is not the empty string, because the language server reads
 * that as no answer and then refuses every file the mapper is given.
 */
const INFERRED_IDENTITY = "inferred";

/**
 * The mapper, as `ts-content-mapper` runs one.
 *
 * @returns A definition holding no state of its own: what it remembers is kept per project, which
 *   the compiler opens and closes.
 */
export function createMapper(): ContentMapperDefinition<JsonObject, MapperProject> {
  return {
    diagnosticSource: DIAGNOSTIC_SOURCE,
    openProject(params) {
      const root = params.configFileName === "" ? null : dirname(params.configFileName);
      const project: MapperProject = { facts: new Map(), root };
      if (root === null) {
        return { configIdentity: INFERRED_IDENTITY, project };
      }
      const folders = projectFoldersUnder(root);
      /* The compiler reads every file again when this changes, so it says only what would change
         one: what each project at or under the `tsconfig` gives its documents, and not when it
         was saved. A file with a project file's name that is a page gives nothing, and is not
         said. */
      const given = new Map<string, ProjectGives>();
      for (const folder of folders) {
        const found = findEnclosingProjectOnDisk(folder, folder);
        if (found) {
          const name = relative(root, folder).split(sep).join("/");
          given.set(name === "" ? "." : name, givenBy(found, project));
        }
      }
      /* Either name in each folder, so that a project changing its format is seen, and beside the
         `tsconfig` whether one is there or not, so that one appearing is. */
      const watched = new Set([root, ...folders]);
      return {
        configIdentity: JSON.stringify(Object.fromEntries(given)),
        project,
        watchedFiles: [...watched].flatMap((folder) =>
          PROJECT_FILE_NAMES.map((name) => join(folder, name)),
        ),
      };
    },
    transform(params, context) {
      const { content, fileName } = params;
      const written = generateVirtualDocument(content, {
        outside: outsideOf(fileName, context.project),
        specifier: `./${baseName(fileName)}`,
      });
      const encoding = context.positionEncoding;
      return {
        ...mappedOutput(written.main, content, encoding),
        diagnostics: written.problems.map((problem) => {
          const start = stringIndexToPosition(content, problem.offset, encoding);
          const end = stringIndexToPosition(content, problem.offset + problem.length, encoding);
          return { code: NOT_NOTATION, length: end - start, messageText: problem.message, start };
        }),
        supplemental: written.supplemental.map((unit) => mappedOutput(unit, content, encoding)),
      };
    },
  };
}
