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
 * so its `State` is open, and only the project file says which.
 *
 * @docs framework/concepts/type-checking
 */
import { dirname, relative, sep } from "node:path";

import { isString } from "@jxsuite/schema/guards";
import { baseName } from "@jxsuite/schema/project-file";
import {
  findEnclosingProjectOnDisk,
  isSameStamp,
  projectFileStamp,
  readProjectFile,
} from "@jxsuite/schema/project-file/node";
import type { ProjectFileStamp } from "@jxsuite/schema/project-file/node";
import type { JsonObject } from "@jxsuite/schema/types";
import { generateVirtualDocument } from "@jxsuite/schema/virtual-document";
import type { OutsideState, VirtualUnit } from "@jxsuite/schema/virtual-document";
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

/** What a project gives the documents in it. */
interface ProjectFacts {
  /** It names a default layout. */
  layout: boolean;
  /** It has `state` of its own. */
  state: boolean;
}

/** What is remembered between files of one compile. */
export interface MapperProject {
  /** Each project folder met, as its file last read. */
  facts: Map<string, { facts: ProjectFacts; stamp: ProjectFileStamp }>;
  /** The folder holding the `tsconfig`, above which no project is looked for. */
  root: string | null;
}

/**
 * A project file that cannot be read gives nothing away, so a document in its folder is assumed to
 * inherit everything: the file's own error is the one to report, not a hundred about `state`.
 */
const UNREADABLE: ProjectFacts = { layout: true, state: true };

/** Read what a project gives its documents, from its file as it is now. */
function readFacts(root: string): ProjectFacts {
  const read = readProjectFile(root);
  if (read === null || "error" in read) {
    return UNREADABLE;
  }
  return {
    layout: isString(read.config.defaults?.layout),
    state: Object.keys(read.config.state ?? {}).length > 0,
  };
}

/** What a project gives its documents, read again only when its file has changed. */
function factsOf(root: string, project: MapperProject): ProjectFacts {
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
  if (folder === "components") {
    // A component is a scope of its own, and nothing of the project's is merged into it.
    return {};
  }
  const facts = found.verdict === "project" ? factsOf(found.root, project) : UNREADABLE;
  // A layout is what wraps a page, and is not itself wrapped by the default one.
  return { layout: facts.layout && folder !== "layouts", state: facts.state };
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
  return { extension: ".ts", mappings, text: unit.text };
}

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
        return { configIdentity: "", project };
      }
      const stamp = projectFileStamp(root);
      /* The compiler reads every file again when this changes, so it says only what would change
         one: what the project beside the `tsconfig` gives its documents, and not when it was
         saved. */
      const facts = stamp === null ? null : factsOf(root, project);
      return {
        configIdentity: JSON.stringify(facts),
        project,
        // Either name, so that a project file appearing is seen as well as one changing.
        watchedFiles: [`${root}${sep}project.jxn`, `${root}${sep}project.json`],
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
