/**
 * The New Project wizard's Import source step: an AI-guided clone of an existing site. Gated behind
 * the AI credentials gate (key form + the keyless Cloudflare option) until AI is usable — a local
 * key, or a backend holding its own; otherwise a URL, crawl options, a model and a brief. The
 * name/directory parameters live on the wizard's shared second step.
 *
 * **This form no longer runs the import.** It gathers a brief and hands it to the assistant, which
 * runs the pipeline as a tool call. The wizard used to own the run, and the consequence was that a
 * successful import destroyed its own account of itself: every phase line and every warning lived
 * in a log that vanished with the modal at the moment it handed off. In the transcript the run
 * survives, the model can read what the crawl actually found, and it can stop and ask about
 * anything the pipeline had to guess at.
 *
 * **It no longer draws the form either.** `surfaces/new-project.json` renders the fields and
 * branches on {@link ImportView.breakpointValue}; what is left here is the state, the policy, the
 * brief and one projection of all three. The gate went with the template — whether AI is usable is
 * a question about the wizard rather than about this tab, so the modal asks it and picks the body,
 * and the credentials form and the Cloudflare offer this tab used to interpolate are islands the
 * surface hosts.
 */

import { getPlatform } from "../platform";
import { preferredModel } from "../services/ai-models";
import { createModelPicker } from "../ui/ai-model-picker";
import { destinationPath } from "./location-fields";
import type { CreateProjectDestination, ImportBreakpointPolicy } from "../types";

import { setPendingImportBrief } from "../services/import-seed";
import type { ImportBrief } from "../services/import-seed";

/** The three answers the Breakpoints control offers. */
type BreakpointMode = "all" | "limit" | "explicit";

/** How a kept width matches one the site declared. */
type BreakpointRounding = "nearest" | "down" | "up";

/** The most breakpoints the control will offer to keep — `@jxsuite/import`'s own ceiling. */
const MAX_BREAKPOINTS = 12;

/**
 * The deepest crawl the pipeline accepts.
 *
 * The field said 2 while `import_site` and the endpoint both clamped to 5, so the wizard could not
 * ask for a depth the backend was willing to run.
 */
const MAX_DEPTH = 5;

export interface ImportTabCtx {
  /** The wizard's shared name/directory state (the import destination slug). */
  form: { name: string; directory: string };
  /**
   * Validate the shared second step and return where to write, or null when something is missing
   * (the wizard has already rendered the reason inline). Either destination shape: a hosted backend
   * imports into a repository it creates, so `"repo"` reaches here too.
   */
  resolveDestination: () => CreateProjectDestination | null;
  rerender: () => void;
  /**
   * Called with the brief the form gathered. The wizard closes WITHOUT a project — the assistant
   * runs the import as a tool call and creates it.
   */
  onHandoff: (brief: ImportBrief) => void;
}

let _url = "";
let _depth = 1;
let _maxPages = 20;
/**
 * How many of the site's breakpoints the project keeps, and how a kept width matches a declared
 * one.
 *
 * Three by default, and that default is the point of the control. A real site declares as many
 * breakpoints as it has accumulated frameworks — nine is ordinary — and the importer used to keep
 * every one, so an imported project opened with nine canvas sizes and nine columns in every style
 * editor. Nobody authors against nine, and nobody chose these nine.
 */
let _breakpointMode: BreakpointMode = "limit";
let _breakpointCount = 3;
let _breakpointWidths = "";
let _breakpointRounding: BreakpointRounding = "nearest";
let _aiNaming = true;
/**
 * The model this import will run its AI passes on. Empty means "whatever the assistant would use",
 * which is what the tab did silently before there was a picker.
 *
 * A DRAFT, not the `jx.ai.model` preference: choosing a model for one import must not retarget the
 * assistant for every later conversation. `startImport` falls back to {@link preferredModel} so an
 * untouched picker behaves exactly as the tab did before.
 */
let _model = "";
/** What the user wants done with the site once it is imported. Handed to the assistant. */
let _prompt = "";
/**
 * Build the result and screenshot-diff it against the original.
 *
 * Off by default because it roughly doubles the run: a full compile plus a second browser pass.
 * Worth offering because it produces the only finding that says how WELL the clone came out — every
 * other one is a count of things that were skipped, and a page at 61% fidelity is a question the
 * assistant can put to a person.
 */
let _verify = false;
/**
 * The average fidelity the clone has to reach before the run counts as having matched the original.
 *
 * A floor, not a quality target: a faithful import of a complicated site lands well under 100 for
 * reasons no importer can fix (a rotating hero, a font rendering a hair differently). What it
 * catches is the other case — the clone that came out at 8% and reported success anyway. Same
 * default as `jx-import --min-fidelity`, so the two surfaces answer the same question the same
 * way.
 *
 * Failing it is a FINDING here rather than a failure: the project is written and opened either way,
 * and the assistant reports that the bar was missed. The CLI turns the same number into an exit
 * code because a script in a pipeline has nobody to tell.
 */
let _minFidelity = 25;
let _errorMsg = "";
let _dirManual = false;

/** Reset the tab's state when the modal opens. */
export function resetImportTab() {
  _url = "";
  _depth = 1;
  _maxPages = 20;
  _breakpointMode = "limit";
  _breakpointCount = 3;
  _breakpointWidths = "";
  _breakpointRounding = "nearest";
  _aiNaming = true;
  _model = "";
  _prompt = "";
  _verify = false;
  _minFidelity = 25;
  _errorMsg = "";
  _dirManual = false;
}

/**
 * The tab's model picker, and the scheduler it repaints through.
 *
 * Created once and kept: `createModelPicker` holds the in-flight fetch and the failed-connection
 * record, and a picker rebuilt per render would re-fetch the catalogue on every keystroke. The
 * scheduler is a SLOT rather than a captured closure because `ImportTabCtx` is rebuilt per render
 * (see `importCtxFor`), so the picker must reach whichever one is current.
 */
let _rerender: (() => void) | null = null;
let _picker: ReturnType<typeof createModelPicker> | null = null;

function modelPicker() {
  _picker ??= createModelPicker({
    getModel: () => _model || preferredModel(),
    // A draft, deliberately not `setModel` — see `_model`.
    onChange: (id) => {
      _model = id;
    },
    requestRender: () => _rerender?.(),
    /* A field in a form column, so the control takes the column's width — the shape it used to get
       from `.new-project-import-model`, said to the surface that owns the rule instead. */
    width: "fill",
  });
  return _picker;
}

/**
 * The picker's host element, for the wizard's `model-island`.
 *
 * Asking is what brings the picker's own mounted document up to date, so the wizard calls this on
 * every repaint and puts the answer back where it already is.
 *
 * @returns {HTMLElement}
 */
export function importModelHost(): HTMLElement {
  return modelPicker().render();
}

/**
 * The policy the three controls describe.
 *
 * Exported so a test can read what the form would send without driving the assistant, for the same
 * reason {@link importBriefFor} is.
 *
 * @returns {ImportBreakpointPolicy}
 */
export function breakpointPolicyFromForm(): ImportBreakpointPolicy {
  if (_breakpointMode === "all") {
    return { mode: "all" };
  }
  if (_breakpointMode === "explicit") {
    const widths = _breakpointWidths
      .split(",")
      .map((part) => Math.trunc(Number(part.trim())))
      .filter((width) => Number.isFinite(width) && width > 0);
    /* A half-typed width list is not an instruction to keep nothing. Until it parses into at least
       one width, the form still means "three, evenly spaced" — the value the field started from. */
    if (widths.length > 0) {
      return { mode: "explicit", rounding: _breakpointRounding, widths };
    }
  }
  return { count: _breakpointCount, mode: "limit", rounding: _breakpointRounding };
}

/**
 * Whether this backend can answer the fidelity question at all.
 *
 * `verify` builds the emitted project with the compiler and serves it to screenshot every page
 * against the original — it executes the project's own JavaScript, so `@jxsuite/import` keeps that
 * phase out of the portable pipeline entirely and a hosted backend deliberately never runs it.
 *
 * There is no PAL member for "this backend compiles", so the nearest DECLARED fact stands in:
 * `createDestination`. A `"repo"` platform commits the emitted project into a git tree it never
 * checks out, which is the same set of hosts and one the tab can read without naming a platform by
 * id. Offering the switch there would collect an answer nothing acts on.
 */
function canVerify(): boolean {
  return getPlatform().createDestination !== "repo";
}

function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

/**
 * Validate the source step (the URL) before advancing to the second step. Sets the inline error and
 * returns false when invalid.
 */
export function validateImportSource(ctx: ImportTabCtx): boolean {
  let parsed: URL | null = null;
  try {
    parsed = new URL(_url.trim());
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    _errorMsg = "Enter a valid URL (e.g. https://example.com)";
    ctx.rerender();
    return false;
  }
  _errorMsg = "";
  return true;
}

/**
 * The brief this form has gathered, or null when something is still missing (the wizard has already
 * rendered the reason inline).
 *
 * Exported so a test can read what the form would hand over without driving the assistant.
 *
 * @param {ImportTabCtx} ctx
 * @returns {ImportBrief | null}
 */
export function importBriefFor(ctx: ImportTabCtx): ImportBrief | null {
  let parsed: URL;
  try {
    parsed = new URL(_url.trim());
  } catch {
    _errorMsg = "Enter a valid URL (e.g. https://example.com)";
    ctx.rerender();
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    _errorMsg = "The URL must start with http:// or https://";
    ctx.rerender();
    return null;
  }
  const destination = ctx.resolveDestination();
  if (!destination) {
    return null;
  }
  return {
    aiComponents: _aiNaming,
    breakpoints: breakpointPolicyFromForm(),
    depth: _depth,
    directory: destinationPath(destination, ctx.form.directory),
    maxPages: _maxPages,
    model: _model,
    name: ctx.form.name.trim(),
    prompt: _prompt.trim(),
    minFidelity: _minFidelity,
    url: parsed.href,
    /* Never asked for where it cannot run: the switch is not rendered there, and a value left over
       from a session on another platform must not travel as a request the backend would ignore. */
    verify: canVerify() && _verify,
  };
}

/**
 * Hand the brief to the assistant and close the wizard. Wired to the wizard's primary button.
 *
 * **The wizard does not run the import any more.** It used to, and the run's whole account of
 * itself — every phase line, every warning — was destroyed the moment it succeeded and the modal
 * handed off. It is a tool call now (`services/ai-import-tools.ts`), so the progress lives in the
 * transcript, the model can read what the crawl actually found, and it can stop and ask about
 * anything the pipeline had to guess at.
 *
 * @param {ImportTabCtx} ctx
 */
export function handoffImport(ctx: ImportTabCtx) {
  if (!getPlatform().importSite) {
    return;
  }
  const brief = importBriefFor(ctx);
  if (!brief) {
    return;
  }
  /* Stored HERE, by the form that gathered it, rather than inside the assistant's hand-off: two
     readers need it — the turn that gets composed now, and `import_site` minutes later for the
     destination — and the producer is the one place both can be sure it was written. */
  setPendingImportBrief(brief);
  ctx.onHandoff(brief);
}

/** The wizard's primary-button label on this tab. One state: it hands off and closes. */
export function importButtonLabel(): string {
  return "Import Site";
}

/**
 * What the chosen mode will actually do, said under the control rather than beside it so a long
 * sentence wraps instead of squeezing the row.
 */
function breakpointHint(): string {
  if (_breakpointMode === "all") {
    return "Every breakpoint the site declares becomes a canvas size. Real sites often declare nine.";
  }
  if (_breakpointMode === "explicit") {
    return "The project gets these widths, each backed by the declared width nearest it.";
  }
  return "Evenly spaced across the widths the site declares — the narrowest, the widest, and the ones between.";
}

/** The Import step as the wizard's document draws it: strings, flags and rows. */
export interface ImportView {
  url: string;
  depth: string;
  maxDepth: string;
  maxPages: string;
  breakpointMode: string;
  breakpointModes: { value: string; label: string }[];
  /** Which value control the chosen mode takes: a count, a width list, or neither. */
  breakpointValue: "count" | "widths" | "none";
  breakpointCount: string;
  maxBreakpoints: string;
  breakpointWidths: string;
  breakpointRounding: string;
  roundings: { value: string; label: string }[];
  breakpointHint: string;
  aiNaming: boolean;
  canVerify: boolean;
  verify: boolean;
  minFidelity: string;
  prompt: string;
  error: string;
}

/**
 * Everything the Import step draws, as one record.
 *
 * It also re-points the model picker's scheduler at the current context, which is what
 * `renderImportSource` did on the same call: `ImportTabCtx` is rebuilt per repaint, so the picker
 * has to reach whichever one is live when its catalogue settles.
 *
 * @param {ImportTabCtx} ctx
 * @returns {ImportView}
 */
export function importView(ctx: ImportTabCtx): ImportView {
  _rerender = ctx.rerender;
  return {
    aiNaming: _aiNaming,
    breakpointCount: String(_breakpointCount),
    breakpointHint: breakpointHint(),
    breakpointMode: _breakpointMode,
    breakpointModes: [
      { label: "Limit to", value: "limit" },
      { label: "Custom widths", value: "explicit" },
      { label: "Keep all", value: "all" },
    ],
    breakpointRounding: _breakpointRounding,
    breakpointValue:
      _breakpointMode === "limit" ? "count" : _breakpointMode === "explicit" ? "widths" : "none",
    breakpointWidths: _breakpointWidths,
    canVerify: canVerify(),
    depth: String(_depth),
    error: _errorMsg,
    maxBreakpoints: String(MAX_BREAKPOINTS),
    maxDepth: String(MAX_DEPTH),
    maxPages: String(_maxPages),
    minFidelity: String(_minFidelity),
    prompt: _prompt,
    roundings: [
      { label: "nearest", value: "nearest" },
      { label: "round down", value: "down" },
      { label: "round up", value: "up" },
    ],
    url: _url,
    verify: _verify,
  };
}

/**
 * The Site URL moved.
 *
 * It also prefills the project name from the hostname while the user has not typed one, which is
 * why it takes the wizard's context: the name and the slug are the shared second step's, and this
 * is the one field that can guess at them.
 *
 * @param {ImportTabCtx} ctx
 * @param {string} value
 */
export function setImportUrl(ctx: ImportTabCtx, value: string): void {
  _url = value;
  if (ctx.form.name.trim()) {
    return;
  }
  try {
    const host = new URL(_url).hostname.replace(/^www\./, "");
    if (host) {
      ctx.form.name = host;
      if (!_dirManual) {
        ctx.form.directory = slugOf(host);
      }
    }
  } catch {
    /* Partial URL while typing — leave the name alone. */
  }
}

/** How deep the crawl follows links. A field emptied to nothing means the front page alone. */
export function setImportDepth(value: string): void {
  _depth = Math.trunc(Number(value)) || 0;
}

/** How many pages the crawl may take at most. Never zero — a run with no pages is not a run. */
export function setImportMaxPages(value: string): void {
  _maxPages = Math.trunc(Number(value)) || 1;
}

/** Which of the three breakpoint answers the reader chose. */
export function setBreakpointMode(value: string): void {
  _breakpointMode = value as BreakpointMode;
}

/** How many breakpoints to keep under `limit`. Falls back to the default the field started from. */
export function setBreakpointCount(value: string): void {
  _breakpointCount = Math.trunc(Number(value)) || 3;
}

/** The comma-separated width list under `explicit`, exactly as it is being typed. */
export function setBreakpointWidths(value: string): void {
  _breakpointWidths = value;
}

/** Which declared width backs a kept one. */
export function setBreakpointRounding(value: string): void {
  _breakpointRounding = value as BreakpointRounding;
}

/** Whether the importer names components with a model rather than by position. */
export function setImportAiNaming(on: boolean): void {
  _aiNaming = on;
}

/** Whether the run screenshots the clone against the original. */
export function setImportVerify(on: boolean): void {
  _verify = on;
}

/** The fidelity floor, clamped to a percentage: a bar outside 0–100 is not a bar. */
export function setImportMinFidelity(value: string): void {
  const raw = Math.trunc(Number(value));
  _minFidelity = Number.isNaN(raw) ? 0 : Math.min(100, Math.max(0, raw));
}

/** What the reader wants done with the site once it is in. */
export function setImportPrompt(value: string): void {
  _prompt = value;
}
