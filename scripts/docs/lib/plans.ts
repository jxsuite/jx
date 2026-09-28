/**
 * Parser and graph for `plans/`: the transient implementation plans that close the specs' open
 * items. The contract is `plans/README.md`; the gate is `check-plans.ts`; the printer is
 * `plans-status.ts`.
 *
 * A plan's ID is its path (`plans/compiler/csp-emission.md` is `compiler/csp-emission`), so the ID
 * cannot drift from the file, and its title is its one H1. Everything else a plan says about itself
 * is frontmatter: what it claims (spec sections, in the docs `spec:` grammar), what it requires
 * (other plans), and where it stands.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { splitFrontmatter } from "./frontmatter.ts";
import { compareIds, GAP_SLUG } from "./standards.ts";

export const PLANS_DIR = "plans";
/** The home of a plan that claims items in two or more specs, or enables plans in two or more. */
export const SHARED_HOME = "_shared";

export const PLAN_STATUSES = ["stub", "drafted", "ready", "active"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const DISPOSITIONS = ["implement", "reconcile", "defer", "remove"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const SIZES = ["S", "M", "L"] as const;

/** Every frontmatter key a plan may carry. */
export const PLAN_FIELDS = [
  "status",
  "disposition",
  "claims",
  "requires",
  "gaps",
  "workspaces",
  "size",
  "prs",
] as const;
export const REQUIRED_FIELDS = ["status", "disposition", "claims", "size"] as const;
/** The list-valued fields: absent means empty. */
export const LIST_FIELDS = ["claims", "requires", "gaps", "workspaces", "prs"] as const;

/** Headings every plan past `stub` carries, in the order the template writes them. */
export const TEMPLATE_HEADINGS = [
  "Context",
  "Outcome",
  "Decisions",
  "Implementation",
  "Tests",
  "Specs & docs",
  "Acceptance",
] as const;

/** `compiler.md` or `compiler.md#13.1`: the docs `spec:` grammar, without a `specs/` prefix. */
const CLAIM = /^([a-z0-9]+(?:-[a-z0-9]+)*\.md)(?:#(\d+(?:\.\d+)*[a-z]?))?$/;
/** `jxsuite/jx#384`. */
export const PR_REF = /^[\w.-]+\/[\w.-]+#\d+$/;
/**
 * A slice id: an uppercase-led prefix, a dot and a number (`<PREFIX>.<n>`). Distinctive on purpose:
 * `check-plans.ts` searches every tracked file for each declared slice id, and a bare `3` or `P1`
 * would match half the repository.
 */
export const SLICE_ID = /^[A-Z][A-Z0-9]*\.\d+[a-z]?$/;
/** `plan:` then `<home>/<slug>`, optionally `#<slice>`. The prefix is what makes it searchable. */
export const PLAN_CITATION = /\bplan:([a-z0-9_-]+\/[a-z0-9-]+)(?:#([A-Z][A-Z0-9]*\.\d+[a-z]?))?/g;
/** A `*-PLAN.md` file: the form plans took before `plans/` existed. */
export const LEGACY_PLAN_DOC = /(?:^|\/)[A-Z0-9-]+-PLAN\.md$/;

const FENCE = /^\s*(```|~~~)/;
const H1 = /^#\s+(.+?)\s*$/;
const H2 = /^##\s+(.+?)\s*$/;
const OPEN_DECISION = /^\s*(?:[-*]|\d+\.)\s+\*\*Open:\*\*/;

export type PathKind =
  | { kind: "contract" }
  | { kind: "audit"; stem: string }
  | { kind: "plan"; id: string; home: string; slug: string }
  | { kind: "stray"; reason: string };

/**
 * What a path under `plans/` is. `rel` is repository-relative with forward slashes. Whether a
 * `<home>` names a real spec is the gate's question, not the path's.
 */
export function classifyPlanPath(rel: string): PathKind {
  const parts = rel.split("/");
  if (parts[0] !== PLANS_DIR) {
    return { kind: "stray", reason: "not under plans/" };
  }
  if (parts.length === 2 && parts[1] === "README.md") {
    return { kind: "contract" };
  }
  if (parts.length !== 3) {
    return {
      kind: "stray",
      reason:
        "plans live at plans/<spec-stem>/<slug>.md, plans/<spec-stem>/README.md or plans/_shared/<slug>.md",
    };
  }
  const [, home, file] = parts as [string, string, string];
  if (!file.endsWith(".md")) {
    return { kind: "stray", reason: "only Markdown lives under plans/" };
  }
  if (file === "README.md") {
    return home === SHARED_HOME
      ? {
          kind: "stray",
          reason: "plans/_shared/ holds plans only; an audit record belongs to a spec",
        }
      : { kind: "audit", stem: home };
  }
  const slug = file.slice(0, -".md".length);
  if (!GAP_SLUG.test(slug) || slug === "readme") {
    return { kind: "stray", reason: `"${slug}" is not a kebab-case slug` };
  }
  if (home !== SHARED_HOME && !GAP_SLUG.test(home)) {
    return { kind: "stray", reason: `"${home}" is not a spec stem` };
  }
  return { kind: "plan", id: `${home}/${slug}`, home, slug };
}

export interface Claim {
  raw: string;
  file: string;
  anchor?: string;
}

/** `compiler.md#13.1` → `{file, anchor}`; null when the grammar does not hold. */
export function parseClaim(raw: string): Claim | null {
  const m = raw.match(CLAIM);
  if (!m) {
    return null;
  }
  return m[2] === undefined ? { raw, file: m[1]! } : { raw, file: m[1]!, anchor: m[2] };
}

export interface FieldProblem {
  field: string;
  message: string;
}

export interface Citation {
  /** The cited plan ID. */
  target: string;
  slice?: string;
  line: number;
}

export interface PlanDoc {
  /** Repository-relative, e.g. `plans/compiler/csp-emission.md`. */
  path: string;
  id: string;
  home: string;
  slug: string;
  frontmatter: "absent" | "invalid" | "parsed";
  frontmatterError?: string;
  status?: string;
  disposition?: string;
  size?: string;
  claims: string[];
  requires: string[];
  gaps: string[];
  workspaces: string[];
  prs: string[];
  unknownFields: string[];
  missingFields: string[];
  fieldProblems: FieldProblem[];
  /** The text of every H1 outside fenced code: a plan has exactly one. */
  titles: string[];
  /** Every `## ` heading, in order. */
  sections: { title: string; line: number }[];
  /** Lines of `**Open:**` items inside `## Decisions`. */
  openDecisions: number[];
  /** The first-column ids of the table under `## Slices`. */
  slices: { id: string; line: number }[];
  citations: Citation[];
}

/** The first column of every body row of the first table under `## Slices`. */
function sliceRows(lines: { text: string; line: number }[]): { id: string; line: number }[] {
  const rows: { id: string; line: number }[] = [];
  let seenTable = false;
  for (const { text, line } of lines) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("|")) {
      if (seenTable) {
        break;
      }
      continue;
    }
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
    const first = cells[0]!.trim().replaceAll("`", "");
    if (!seenTable) {
      // The header row.
      seenTable = true;
      continue;
    }
    if (/^:?-{3,}:?$/.test(first)) {
      continue;
    }
    rows.push({ id: first, line });
  }
  return rows;
}

/** Parse one plan file's source. `path` is repository-relative. */
export function parsePlanSource(source: string, path: string, id: string): PlanDoc {
  const [home = "", slug = ""] = id.split("/");
  const doc: PlanDoc = {
    path,
    id,
    home,
    slug,
    frontmatter: "absent",
    claims: [],
    requires: [],
    gaps: [],
    workspaces: [],
    prs: [],
    unknownFields: [],
    missingFields: [],
    fieldProblems: [],
    titles: [],
    sections: [],
    openDecisions: [],
    slices: [],
    citations: [],
  };

  const split = splitFrontmatter(source);
  doc.frontmatter = split.kind;
  if (split.kind === "invalid") {
    doc.frontmatterError = split.error;
  }
  if (split.kind === "parsed") {
    const { data } = split;
    for (const key of Object.keys(data)) {
      if (!(PLAN_FIELDS as readonly string[]).includes(key)) {
        doc.unknownFields.push(key);
      }
    }
    for (const key of REQUIRED_FIELDS) {
      if (!(key in data)) {
        doc.missingFields.push(key);
      }
    }
    for (const key of ["status", "disposition", "size"] as const) {
      const value = data[key];
      if (value === undefined) {
        continue;
      }
      if (typeof value === "string") {
        doc[key] = value;
      } else {
        doc.fieldProblems.push({ field: key, message: `${key} must be a string` });
      }
    }
    for (const key of LIST_FIELDS) {
      const value = data[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        doc[key] = value;
      } else {
        doc.fieldProblems.push({ field: key, message: `${key} must be a list of strings` });
      }
    }
  }

  // Body: fence-aware walk for headings, decisions, slices and citations.
  const lines = source.split("\n");
  const firstBodyLine = split.kind === "absent" ? 1 : split.bodyLine;
  let inFence = false;
  let current: string | null = null;
  const sliceLines: { text: string; line: number }[] = [];
  for (let i = firstBodyLine - 1; i < lines.length; i++) {
    const text = lines[i]!;
    const line = i + 1;
    for (const m of text.matchAll(PLAN_CITATION)) {
      doc.citations.push(
        m[2] === undefined ? { target: m[1]!, line } : { target: m[1]!, slice: m[2], line },
      );
    }
    if (FENCE.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const h1 = text.match(H1);
    if (h1) {
      doc.titles.push(h1[1]!);
      current = null;
      continue;
    }
    const h2 = text.match(H2);
    if (h2) {
      current = h2[1]!;
      doc.sections.push({ title: current, line });
      continue;
    }
    if (current === "Decisions" && OPEN_DECISION.test(text)) {
      doc.openDecisions.push(line);
    }
    if (current === "Slices") {
      sliceLines.push({ text, line });
    }
  }
  doc.slices = sliceRows(sliceLines);
  return doc;
}

export interface PlanRegistry {
  /** Repository root the paths are relative to. */
  root: string;
  contract: boolean;
  /** Spec stems with a `plans/<stem>/README.md`. */
  audits: Set<string>;
  plans: PlanDoc[];
  strays: { path: string; reason: string }[];
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const name of readdirSync(dir).toSorted()) {
    const abs = join(dir, name);
    const relPath = `${rel}/${name}`;
    if (statSync(abs).isDirectory()) {
      walk(abs, relPath, out);
    } else {
      out.push(relPath);
    }
  }
}

/** Build the registry from `<root>/plans`, as it is on disk (untracked files included). */
export function buildPlanRegistry(root: string): PlanRegistry {
  const registry: PlanRegistry = {
    root,
    contract: false,
    audits: new Set(),
    plans: [],
    strays: [],
  };
  const dir = join(root, PLANS_DIR);
  if (!existsSync(dir)) {
    return registry;
  }
  const files: string[] = [];
  walk(dir, PLANS_DIR, files);
  for (const path of files) {
    const kind = classifyPlanPath(path);
    switch (kind.kind) {
      case "contract": {
        registry.contract = true;
        break;
      }
      case "audit": {
        registry.audits.add(kind.stem);
        break;
      }
      case "plan": {
        const source = readFileSync(join(root, path), "utf8");
        registry.plans.push(parsePlanSource(source, path, kind.id));
        break;
      }
      default: {
        registry.strays.push({ path, reason: kind.reason });
        break;
      }
    }
  }
  registry.plans.sort((a, b) => compareIds(a.id, b.id));
  return registry;
}

/** The first cycle along `requires` edges, as `[a, b, …, a]`, or null. Unknown targets are skipped. */
export function findCycle(plans: readonly PlanDoc[]): string[] | null {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, "visiting");
    stack.push(id);
    for (const next of byId.get(id)?.requires ?? []) {
      if (!byId.has(next)) {
        continue;
      }
      if (state.get(next) === "visiting") {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (state.get(next) === undefined) {
        const found = visit(next);
        if (found) {
          return found;
        }
      }
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const plan of plans) {
    if (state.get(plan.id) === undefined) {
      const found = visit(plan.id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Plans grouped into waves: wave 0 requires nothing that still exists, wave n requires only plans
 * in earlier waves. Plans on a cycle never become free and are returned in `blocked`.
 */
export function topoWaves(plans: readonly PlanDoc[]): { waves: string[][]; blocked: string[] } {
  const ids = new Set(plans.map((p) => p.id));
  const pending = new Map(plans.map((p) => [p.id, p.requires.filter((r) => ids.has(r))]));
  const done = new Set<string>();
  const waves: string[][] = [];
  while (pending.size > 0) {
    const wave = [...pending]
      .filter(([, requires]) => requires.every((r) => done.has(r)))
      .map(([id]) => id)
      .toSorted(compareIds);
    if (wave.length === 0) {
      break;
    }
    for (const id of wave) {
      pending.delete(id);
      done.add(id);
    }
    waves.push(wave);
  }
  return { waves, blocked: [...pending.keys()].toSorted(compareIds) };
}

/**
 * What can be worked on now: plans that are `ready` or `active` and require nothing. A landed
 * prerequisite is deleted along with its edge, so an empty `requires` IS "unblocked".
 */
export function readyQueue(plans: readonly PlanDoc[]): PlanDoc[] {
  const { waves } = topoWaves(plans);
  const order = new Map(waves.flat().map((id, i) => [id, i]));
  return plans
    .filter((p) => (p.status === "ready" || p.status === "active") && p.requires.length === 0)
    .toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * The order to detail specs in: a spec comes after every spec its plans require (transitively,
 * through `_shared`). Specs whose plans require each other form one group. `provisional` breaks
 * ties, then the ID order.
 */
export function specOrder(
  plans: readonly PlanDoc[],
  stems: readonly string[],
  provisional: readonly string[] = [],
): string[][] {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const homesReached = (start: PlanDoc): Set<string> => {
    const seen = new Set<string>();
    const homes = new Set<string>();
    const queue = [...start.requires];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const plan = byId.get(id);
      if (!plan) {
        continue;
      }
      if (plan.home !== SHARED_HOME) {
        homes.add(plan.home);
      }
      queue.push(...plan.requires);
    }
    return homes;
  };
  const edges = new Map<string, Set<string>>(stems.map((s) => [s, new Set()]));
  for (const plan of plans) {
    if (!edges.has(plan.home)) {
      continue;
    }
    for (const home of homesReached(plan)) {
      if (home !== plan.home && edges.has(home)) {
        edges.get(plan.home)!.add(home);
      }
    }
  }

  // Tarjan's strongly connected components; each component is emitted after the ones it reaches.
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  const rank = (s: string) => {
    const i = provisional.indexOf(s);
    return i === -1 ? provisional.length : i;
  };
  const byRank = (a: string, b: string) => rank(a) - rank(b) || compareIds(a, b);
  const connect = (v: string) => {
    indices.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of [...edges.get(v)!].toSorted(byRank)) {
      if (!indices.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indices.get(w)!));
      }
    }
    if (low.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component.toSorted(byRank));
    }
  };
  for (const stem of [...edges.keys()].toSorted(byRank)) {
    if (!indices.has(stem)) {
      connect(stem);
    }
  }
  return components;
}
