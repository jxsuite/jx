/**
 * The shot contract — five verbs, no selectors, no sleeps (scripts/screenshots/README.md).
 *
 * A manifest is a list of shots. Each shot states its **boot state** totally (`open`), **drives**
 * the app through named capabilities (`steps`), **asserts** (`expect`), and **captures** region ids
 * (`capture`). `then` carries follow-on segments that reuse the same boot.
 *
 * The five verbs, and nothing else:
 *
 * | verb      | means                                                                      |
 * | --------- | -------------------------------------------------------------------------- |
 * | `open`    | the world the app wakes up in. Total, never a delta.                       |
 * | `steps`   | exactly one of `cmd` (a registry id) / `seed` (a remote) / `input` (debt). |
 * | `expect`  | a region resolves, or `probe.state()` partially matches. FAILS the shot.   |
 * | `capture` | `{image, of}` where `of` is a REGION ID or the camera's own `viewport`.    |
 * | `then`    | more steps/expect/capture against the same boot — what `variants` was.     |
 *
 * **There is no sixth verb, and these keys are gone**: `wait`, `waitFor`, `clip`, `regions`,
 * `variants`, `actions`, `canvasMode`, `noProject`, `noCanvas`, and `selector` anywhere.
 * {@link REMOVED_SHOT_KEYS} refuses each one by name, because a manifest that still carries them is
 * asking for behaviour the runner deleted rather than behaviour it has yet to implement.
 *
 * Two rules govern the whole file (scripts/screenshots/README.md, R1 and R2):
 *
 * > R1. A shot may name inputs the app accepts. It may never name values the app derives. Deltas,
 * > coordinates and rendered text are all derived. R2. The pipeline may only ask the app to do sooner
 * > what the design already commits to doing.
 */

import { isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

import type { PixelSize } from "../../lib/png.ts";
import { CONTRACT_VERSION } from "./contract.ts";

/** Re-exported so the runner and the manifest's own tests read both facts from one import. */
export { CONTRACT_VERSION, DEFAULT_MANIFEST } from "./contract.ts";

/** `ui.fit` as `canvas/canvas-utils.ts` declares it — declared per shot, never an entry side effect. */
export type FitMode = "width" | "page" | "none" | number;

/** A `JxPath` as a manifest writes one: the document address of a node. */
export type JxPathLike = (string | number)[];

// ─── open ─────────────────────────────────────────────────────────────────────

/** One dock's stated position. Stated, never toggled — a toggle is a delta (studio.md §13.5). */
export interface DockState {
  collapsed?: boolean;
  tab?: string;
}

/**
 * The world the app wakes up in — **total, not a delta**.
 *
 * `profile` is what makes that true: it names a startup profile (`services/profile.ts`), which
 * resets every app-owned key before any other field applies. So a default flip — the assistant
 * leaving its own column, say — is a no-op here instead of silently inverting eighteen steps, which
 * is exactly what happened the last time a shot named a delta.
 *
 * Fields left unstated resolve from `manifest.defaults` and then to the profile's own value. That
 * fallback is a DEFINED state, not "whatever was in storage", which is the only reason omitting a
 * field is allowed at all.
 */
export interface ShotOpen {
  /** Repo-relative project directory. Absent → Studio boots with no project (the welcome screen). */
  project?: string;
  /** Project-relative file to open in a tab. */
  file?: string;
  /** Canvas view — `design` | `edit` | `preview` | `stylebook`. */
  view?: string;
  /** Declared fit, so an implicit fit-on-entry can never move a coordinate underneath a step. */
  fit?: FitMode;
  /** Startup profile id (`services/profile.ts`). Defaults to {@link DEFAULT_PROFILE}. */
  profile?: string;
  /** ISO instant the app's `now()` is pinned to, so relative timestamps stop moving. */
  clock?: string;
  /** Color scheme. */
  theme?: string;
  viewport?: PixelSize;
  deviceScaleFactor?: number;
  /** Dock states by dock id, e.g. `{ "chat": { "collapsed": true } }`. */
  docks?: Record<string, DockState>;
}

/** Boot state with every field decided. `null` means "whatever the profile starts as". */
export interface ResolvedOpen {
  project: string | null;
  file: string | null;
  view: string | null;
  fit: FitMode | null;
  profile: string;
  clock: string | null;
  theme: string | null;
  viewport: PixelSize;
  deviceScaleFactor: number;
  docks: Record<string, DockState>;
}

/** Used when neither the shot nor `manifest.defaults` states one. */
export const DEFAULT_VIEWPORT: PixelSize = { height: 1000, width: 1600 };
export const DEFAULT_DEVICE_SCALE_FACTOR = 2;

/**
 * The profile a shot gets when it does not ask for one.
 *
 * `fresh`, not `default`, and deliberately: a capture of "whatever this machine had in
 * localStorage" is the exact nondeterminism scripts/screenshots/README.md ("Determinism") rules
 * out. Resuming persisted state is a thing a shot has to ask for out loud.
 */
export const DEFAULT_PROFILE = "fresh";

// ─── steps ────────────────────────────────────────────────────────────────────

/**
 * An escape hatch for a surface that is not registry-driven yet: `{reason, until}`.
 *
 * It admits a hand-stamped region id, **never a selector**, so "no CSS in the manifest" is absolute
 * from day one. `scripts/check-shot-contract.ts` commits the count and ratchets it down.
 */
export interface Unstable {
  reason: string;
  /** The phase that retires it. CI fails once that phase has shipped. */
  until: string;
}

/** Run a registry command. The projection refuses unknown, unscriptable and `toggle*` ids. */
export interface CommandStep {
  cmd: string;
  args?: JsonObject;
  unstable?: Unstable;
}

/** Stand in for a remote. Under the Remote Rule a seed never stands in for a user. */
export interface SeedStep {
  seed: string;
  args?: JsonObject;
  unstable?: Unstable;
}

/**
 * The budgeted hatch (scripts/screenshots/README.md, "The five verbs"): state cannot express a
 * gesture **in flight**.
 *
 * Four kinds, and faking any of them would be a worse lie than a two-line hatch — a `dirty: true`
 * primitive is photography, a hover that sets a class is not a hover. Every one is addressed by a
 * REGION ID or a `JxPath`, never by a selector, and the manifest-wide count is committed and
 * monotonically non-increasing. The contract's migration aimed for ≤ 6; `CONTRACT_BUDGET` in
 * `scripts/check-shot-contract.ts` holds the committed count.
 */
export type InputStep = { unstable?: Unstable } & (
  | { input: "hover"; region: string }
  | { input: "type"; text: string; region?: string }
  | { input: "dragOver"; region: string }
  | { input: "caret"; path: JxPathLike; clickCount?: number }
);

export type ShotStep = CommandStep | SeedStep | InputStep;

export const INPUT_KINDS = ["hover", "type", "dragOver", "caret"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

export function isCommandStep(step: ShotStep): step is CommandStep {
  return "cmd" in step && isString(step.cmd);
}

export function isSeedStep(step: ShotStep): step is SeedStep {
  return "seed" in step && isString(step.seed);
}

export function isInputStep(step: ShotStep): step is InputStep {
  return "input" in step && isString(step.input);
}

// ─── expect ───────────────────────────────────────────────────────────────────

/**
 * An assertion that **fails the shot**.
 *
 * `{region}` — the id resolves to an element with a non-empty box. `{state}` — a partial deep match
 * against `probe.state()`, the same `CommandContext` every `when` predicate reads.
 *
 * This is what the 43 `waitFor: {selector}` steps became. A wait that only ever succeeded by
 * arriving late is not an assertion; this one says what the picture is supposed to show.
 */
export type Expectation = { region: string } | { state: JsonObject };

export function isRegionExpectation(e: Expectation): e is { region: string } {
  return "region" in e && isString(e.region);
}

// ─── capture ──────────────────────────────────────────────────────────────────

/**
 * The camera's own frame, for a shot of the whole window.
 *
 * Not a region id and deliberately not spelled like one: it names no DOM node, so no rename can
 * reach it. It is what `clip: {selector: "#app"}` was pretending to be.
 */
export const VIEWPORT_TARGET = "viewport";

export interface Capture {
  /** Output basename without `.png`. Unique across the whole manifest. */
  image: string;
  /** A region id, or {@link VIEWPORT_TARGET}. Defaults to the viewport. */
  of?: string;
  /** CSS px of breathing room on every side (default 0). */
  padding?: number;
  unstable?: Unstable;
}

// ─── then ─────────────────────────────────────────────────────────────────────

/**
 * A follow-on segment against the same boot — what `variants` was, minus its cleanup role.
 *
 * `variants` existed partly so a shot could UNDO the damage it had done to a committed starter
 * file. It cannot do damage any more: the runner opens a copy-on-write overlay of the project
 * (`lib/server.ts`), so the whole class of self-undoing shots is gone and `then` is left doing only
 * the thing it was good at — more pictures from one boot.
 */
export interface ThenSegment {
  steps?: ShotStep[];
  expect?: Expectation[];
  capture?: Capture[];
}

// ─── shots ────────────────────────────────────────────────────────────────────

/** A shot the docs may not reference until someone fixes it (README, "Authoring notes"). */
export interface ShotStatus {
  state: "quarantined";
  reason: string;
  /** The commit at which it rotted. */
  since: string;
}

export interface Shot {
  name: string;
  /** Docs-page slugs this shot illustrates. Inert to capture; `docs:check` and `docs:sync` read it. */
  docs?: string[];
  open?: ShotOpen;
  steps?: ShotStep[];
  expect?: Expectation[];
  capture?: Capture[];
  then?: ThenSegment[];
  status?: ShotStatus;
}

export interface Manifest {
  contract: number;
  outDir: string;
  defaults?: ShotOpen;
  /** Where the runner expects the dev server. Both fields have defaults; the key is optional. */
  server?: { studioPath?: string; url?: string };
  shots: Shot[];
}

export interface ResolvedShot extends Omit<Shot, "open"> {
  open: ResolvedOpen;
}

// ─── The region grammar ───────────────────────────────────────────────────────

/**
 * The eight surfaces the region grammar declares (scripts/screenshots/README.md). A region id
 * always begins with one of these.
 *
 * The runner checks WELL-FORMEDNESS only. Whether an id is one the app actually stamps is Lane 1's
 * question (it reads the registries) and, at capture time, the app's own — an id that resolves to
 * nothing fails the shot where it is used. Duplicating the registry here would be a third answer to
 * a question that already has two.
 */
export const REGION_SURFACES = [
  "rail",
  "navigator",
  "inspector",
  "pane",
  "dock.bottom",
  "statusbar",
  "commandbar",
  "overlay",
] as const;

/** `dock.bottom` is the one surface whose own name contains the instance separator. */
const DOTTED_SURFACES = new Set<string>(["dock.bottom"]);

/**
 * Whether `id` is a well-formed region id: `<surface>[.<instance>][/<part>]`.
 *
 * Rejecting is the point. The resolver never falls back to `querySelector(id)`, so a CSS selector
 * that slips into a manifest is a validation failure rather than something that quietly works.
 */
export function isRegionId(id: string): boolean {
  const slash = id.indexOf("/");
  const head = slash === -1 ? id : id.slice(0, slash);
  const part = slash === -1 ? undefined : id.slice(slash + 1);
  if (head === "" || part === "") {
    return false;
  }
  let surface = head;
  if (!DOTTED_SURFACES.has(head)) {
    const dot = head.indexOf(".");
    if (dot !== -1) {
      surface = head.slice(0, dot);
      if (head.slice(dot + 1) === "") {
        return false;
      }
    }
  }
  return REGION_SURFACES.some((known) => known === surface);
}

/** A capture/hover/type target: a region id, or the camera's own frame. */
export function isCaptureTarget(id: string): boolean {
  return id === VIEWPORT_TARGET || isRegionId(id);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Keys the contract deleted, and what replaced each.
 *
 * A refusal, not a migration: the runner has no code behind any of them, so a manifest still
 * carrying one would otherwise be silently half-executed — the worst possible outcome for a tool
 * whose entire job is to photograph a true state.
 */
export const REMOVED_SHOT_KEYS: ReadonlyMap<string, string> = new Map([
  ["actions", "steps — one of cmd | seed | input per entry"],
  ["canvasMode", "open.view"],
  ["clip", 'capture[].of (a region id, or "viewport")'],
  ["deviceScaleFactor", "open.deviceScaleFactor"],
  ["file", "open.file"],
  ["noCanvas", "nothing — probe.idle() decides when the app has settled"],
  ["noProject", "nothing — omit open.project"],
  ["project", "open.project"],
  ["regions", "capture"],
  ["selector", "a region id"],
  ["theme", "open.theme"],
  ["variants", "then"],
  ["viewport", "open.viewport"],
  ["wait", "nothing — probe.idle() replaced all 115 sleeps"],
  ["waitFor", "expect"],
]);

function fail(message: string): never {
  throw new Error(`manifest: ${message}`);
}

function checkRemovedKeys(where: string, entry: JsonObject): void {
  for (const key of Object.keys(entry)) {
    const replacement = REMOVED_SHOT_KEYS.get(key);
    if (replacement !== undefined) {
      fail(`${where}: "${key}" was deleted by the shot contract — use ${replacement}`);
    }
  }
}

function validateOpen(where: string, open: JsonValue): void {
  if (!isJsonObject(open)) {
    fail(`${where}: open must be an object`);
  }
  for (const [key, value] of Object.entries(open)) {
    switch (key) {
      case "clock":
      case "file":
      case "profile":
      case "project":
      case "theme":
      case "view": {
        if (!isString(value) || !value) {
          fail(`${where}: open.${key} must be a non-empty string`);
        }
        break;
      }
      case "deviceScaleFactor": {
        if (!isNumber(value) || value <= 0) {
          fail(`${where}: open.deviceScaleFactor must be a positive number`);
        }
        break;
      }
      case "docks": {
        if (!isJsonObject(value)) {
          fail(`${where}: open.docks must be an object keyed by dock id`);
        }
        break;
      }
      case "fit": {
        const ok = isNumber(value) || (isString(value) && FIT_WORDS.has(value));
        if (!ok) {
          fail(`${where}: open.fit must be "width" | "page" | "none" or a number`);
        }
        break;
      }
      case "viewport": {
        if (!isJsonObject(value) || !isNumber(value.width) || !isNumber(value.height)) {
          fail(`${where}: open.viewport must be {width, height}`);
        }
        break;
      }
      default: {
        fail(`${where}: unknown open field "${key}"`);
      }
    }
  }
}

const FIT_WORDS = new Set(["none", "page", "width"]);

function validateStep(where: string, step: JsonValue): void {
  if (!isJsonObject(step)) {
    fail(`${where}: every step must be an object`);
  }
  if (isString(step.selector)) {
    fail(
      `${where}: a step may never name a selector — say it in a command id, a region id or a JxPath`,
    );
  }
  const verbs = ["cmd", "seed", "input"].filter((verb) => step[verb] !== undefined);
  if (verbs.length !== 1) {
    fail(
      `${where}: a step carries exactly one of cmd | seed | input (found ${
        verbs.length === 0 ? "none" : verbs.join(" + ")
      })`,
    );
  }
  if (isString(step.cmd) && !step.cmd) {
    fail(`${where}: cmd must be a command id`);
  }
  if (isString(step.seed) && !step.seed) {
    fail(`${where}: seed must be a seed id`);
  }
  if (step.input === undefined) {
    return;
  }
  const kind = step.input;
  if (!isString(kind) || !INPUT_KINDS.some((known) => known === kind)) {
    fail(`${where}: input must be one of ${INPUT_KINDS.join(" | ")}`);
  }
  if ((kind === "hover" || kind === "dragOver") && !isString(step.region)) {
    fail(`${where}: input "${kind}" needs a region id`);
  }
  if (kind === "type" && !isString(step.text)) {
    fail(`${where}: input "type" needs text`);
  }
  if (kind === "caret" && !Array.isArray(step.path)) {
    fail(`${where}: input "caret" needs a JxPath`);
  }
  if (isString(step.region) && !isRegionId(step.region)) {
    fail(`${where}: "${step.region}" is not a region id (<surface>[.<instance>][/<part>])`);
  }
}

function validateExpectation(where: string, entry: JsonValue): void {
  if (!isJsonObject(entry)) {
    fail(`${where}: every expect entry must be an object`);
  }
  const { region } = entry;
  const hasRegion = isString(region);
  const hasState = isJsonObject(entry.state);
  if (hasRegion === hasState) {
    fail(`${where}: an expect entry carries exactly one of region | state`);
  }
  if (hasRegion && !isRegionId(region)) {
    fail(`${where}: expect region "${region}" is not a region id`);
  }
}

/**
 * Check a parsed manifest against the shot contract, throwing on the first violation.
 *
 * The one place a manifest is still raw JSON: everything downstream of {@link validateManifest}
 * reads a {@link Manifest}.
 */
function assertManifest(raw: JsonValue): asserts raw is JsonObject & Manifest {
  if (!isJsonObject(raw)) {
    fail("root must be an object");
  }
  if (raw.contract !== CONTRACT_VERSION) {
    fail(
      `declares contract ${JSON.stringify(raw.contract)}; this runner implements ${CONTRACT_VERSION}`,
    );
  }
  if (!isString(raw.outDir) || !raw.outDir) {
    fail("outDir must be a non-empty string");
  }
  if (raw.defaults !== undefined) {
    validateOpen("manifest defaults", raw.defaults);
  }
  if (!Array.isArray(raw.shots) || raw.shots.length === 0) {
    fail("shots must be a non-empty array");
  }

  const shotNames = new Set<string>();
  const images = new Set<string>();
  const claimImage = (name: JsonValue | undefined, where: string) => {
    if (!isString(name) || !name) {
      fail(`${where}: every capture needs an image name`);
    }
    if (images.has(name)) {
      fail(`${where}: duplicate image name "${name}"`);
    }
    images.add(name);
  };
  const validateCaptures = (where: string, captures: JsonValue | undefined) => {
    for (const capture of asArray(where, "capture", captures)) {
      if (!isJsonObject(capture)) {
        fail(`${where}: every capture must be an object`);
      }
      claimImage(capture.image, where);
      const target = capture.of ?? VIEWPORT_TARGET;
      if (!isString(target) || !isCaptureTarget(target)) {
        fail(
          `${where}: capture "${String(capture.image)}" names "${String(target)}", which is neither ` +
            `a region id nor "${VIEWPORT_TARGET}" — a capture never names a selector`,
        );
      }
      if (capture.padding !== undefined && !isNumber(capture.padding)) {
        fail(`${where}: capture "${String(capture.image)}" padding must be a number`);
      }
    }
  };

  for (const [index, shot] of raw.shots.entries()) {
    if (!isJsonObject(shot)) {
      fail(`shot #${index + 1} must be an object`);
    }
    if (!isString(shot.name) || !shot.name) {
      fail(`shot #${index + 1} needs a name`);
    }
    const where = `shot "${shot.name}"`;
    if (shotNames.has(shot.name)) {
      fail(`duplicate shot name "${shot.name}"`);
    }
    shotNames.add(shot.name);
    checkRemovedKeys(where, shot);
    if (shot.open !== undefined) {
      validateOpen(where, shot.open);
    }
    for (const [n, step] of asArray(where, "steps", shot.steps).entries()) {
      validateStep(`${where} step ${n + 1}`, step);
    }
    for (const entry of asArray(where, "expect", shot.expect)) {
      validateExpectation(where, entry);
    }
    validateCaptures(where, shot.capture);
    for (const [n, segment] of asArray(where, "then", shot.then).entries()) {
      const segmentWhere = `${where} then[${n}]`;
      if (!isJsonObject(segment)) {
        fail(`${segmentWhere} must be an object`);
      }
      checkRemovedKeys(segmentWhere, segment);
      for (const [s, step] of asArray(segmentWhere, "steps", segment.steps).entries()) {
        validateStep(`${segmentWhere} step ${s + 1}`, step);
      }
      for (const entry of asArray(segmentWhere, "expect", segment.expect)) {
        validateExpectation(segmentWhere, entry);
      }
      validateCaptures(segmentWhere, segment.capture);
    }
  }
}

/** Check a parsed manifest against the shot contract and return it, throwing on the first violation. */
export function validateManifest(raw: JsonValue): Manifest {
  assertManifest(raw);
  return raw;
}

function asArray(where: string, key: string, value: JsonValue | undefined): JsonValue[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${where}: ${key} must be an array`);
  }
  return value;
}

/**
 * Fold `manifest.defaults` into a shot's `open`, leaving every field decided.
 *
 * Field-by-field rather than object spread, because "total" has to mean total: a reader of
 * {@link ResolvedOpen} can see every input the boot depends on without going back to the manifest.
 */
export function resolveShot(manifest: Manifest, shot: Shot): ResolvedShot {
  const d = manifest.defaults ?? {};
  const o = shot.open ?? {};
  const pick = <K extends keyof ShotOpen>(key: K): NonNullable<ShotOpen[K]> | null =>
    o[key] ?? d[key] ?? null;
  return {
    ...shot,
    open: {
      clock: pick("clock"),
      deviceScaleFactor: pick("deviceScaleFactor") ?? DEFAULT_DEVICE_SCALE_FACTOR,
      docks: { ...d.docks, ...o.docks },
      file: pick("file"),
      fit: pick("fit"),
      profile: pick("profile") ?? DEFAULT_PROFILE,
      project: pick("project"),
      theme: pick("theme"),
      view: pick("view"),
      viewport: pick("viewport") ?? DEFAULT_VIEWPORT,
    },
  };
}

/** Every image a shot writes, in capture order — what `--only` reports and the lock will name. */
export function shotImages(shot: Shot): string[] {
  return [
    ...(shot.capture ?? []),
    ...(shot.then ?? []).flatMap((segment) => segment.capture ?? []),
  ].map((capture) => capture.image);
}
