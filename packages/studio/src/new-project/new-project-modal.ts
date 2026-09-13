/// <reference lib="dom" />
/**
 * New Project modal — a two-step wizard.
 *
 * **Step 1 · Choose a starting point.** Starters lead: the first thing offered is a complete site
 * you can look at. The gallery ends with one **Start from scratch** card — the minimal scaffold —
 * because a first-run choice between four breakpoint presets described by media-query direction is
 * a choice nobody can make. Two further sources sit on their own tabs: an **Import** of an existing
 * site, and an **Agent** prompt.
 *
 * **Step 2 · Name your project.** Name and location, nothing else. A project's URL, deployment
 * adapter and design tokens are settings, not creation-time decisions, so they live in the
 * project's own settings surface where they can be changed more than once.
 *
 * Import and Agent need working AI, so both are gated until credentials exist — a key stored in
 * this browser, or a backend that holds its own (managed cloud platforms, env-keyed dev servers).
 * While gated they offer the same two paths as the assistant sidebar: connect Cloudflare for
 * Workers AI, or bring a key.
 *
 * **The dialog is a document.** `surfaces/new-project.json` draws it and `surfaces/new-project.ts`
 * mounts it; this module keeps the flow, the platform calls and the promise. What it used to be is
 * worth recording, because it is the shape every converted surface starts from: one lit template
 * re-rendered from module state on every keystroke, inside a fixed card that painted its own panel
 * beside an `<sp-underlay>`, drew its own header and close button, and needed `z-index: 1000` to
 * climb back out from under its own scrim. A modal `<dialog>` is in the top layer by construction,
 * so none of that stacking is left to get wrong, and a keystroke in the name field now moves one
 * binding rather than rebuilding both steps.
 *
 * **`closeNewProjectModal` went with it**, exactly as `closeAddRepoModal` did. It existed because
 * the lit card had to answer its own Escape key, its own underlay click and its own close button,
 * and all three of those belong to the platform now: every way out raises the dialog's `cancel`,
 * which arrives here as `onClosed`. Its one piece of judgement went with it too — it refused to
 * close while a create was in flight — and that refusal was already unenforceable on this
 * substrate, because nothing may refuse Escape on a modal `<dialog>`. A create that outlives its
 * dialog still finishes and still initialises the repository; the promise has already resolved
 * `null`, so what the caller loses is the hand-off, not the project.
 *
 * @docs studio/projects/create
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { layerHost } from "../ui/layers";
import { enumArg, enumProperty } from "../commands/command-args";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import { getPlatform } from "../platform";
import { installUrlOf } from "../platform-errors";
import { hasAiCredentials } from "../services/ai-models";
import { setPendingAgentPrompt } from "../services/agent-seed";
import { initProjectRepo } from "../files/files";
import { runImportHandoff } from "../services/import-seed";
import { createAiCredentialsForm } from "../ui/ai-credentials-form";
import { createManagedConnect } from "../ui/ai-managed-connect";
import { openNewProjectSurface } from "../surfaces/new-project";
import {
  browseLocation,
  collectDestination,
  loadLocationOptions,
  locationView,
  resetLocationFields,
  setLocationOwner,
  setLocationParent,
  setLocationVisibility,
} from "./location-fields";
import {
  handoffImport,
  importButtonLabel,
  importModelHost,
  importView,
  resetImportTab,
  setBreakpointCount,
  setBreakpointMode,
  setBreakpointRounding,
  setBreakpointWidths,
  setImportAiNaming,
  setImportDepth,
  setImportMaxPages,
  setImportMinFidelity,
  setImportPrompt,
  setImportUrl,
  setImportVerify,
  validateImportSource,
} from "./import-tab";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type { CreateProjectDestination, StarterInfo } from "../types";
import type { ImportTabCtx } from "./import-tab";
import type {
  NewProjectBody,
  NewProjectCard,
  NewProjectSurfaceHandle,
  NewProjectView,
} from "../surfaces/new-project";

type NewProjectTab = (typeof NEW_PROJECT_TABS)[number];
type WizardStep = "source" | "params";

let _handle: NewProjectSurfaceHandle | null = null;

let _form = { directory: "", name: "" };

let _tab: NewProjectTab = "starter";
let _step: WizardStep = "source";
/** The step-1 choice on the Starters tab: a starter id, or `""` for "Start from scratch". */
let _starter = "";
/** Set once the user picks a card, so an arriving starter list stops overriding their choice. */
let _starterTouched = false;
let _agentPrompt = "";

let _error = "";

/**
 * Inline validation error shown at the Project Name field (the global strip is for backend
 * failures).
 */
let _nameError = "";

/** GitHub-App install link carried by a structured needs_installation_access failure. */
let _errorInstallUrl = "";

function captureError(error: unknown) {
  _error = errorMessage(error);
  _errorInstallUrl = installUrlOf(error) ?? "";
}

let _creating = false;

/** Starter templates offered in the gallery (empty until loaded / on platforms without starters). */
let _starters: StarterInfo[] = [];

let _resolve: ((result: { root: string; config: ProjectConfig } | null) => void) | null = null;

let _dirDerived = true;

// One credentials form shared by the Import and Agent gates; lazy so the modal module can load
// Before a platform is registered (the form fetches models through the platform on edit).
let _credsForm: ReturnType<typeof createAiCredentialsForm> | null = null;

function rerenderIfOpen() {
  if (_handle) {
    redraw();
  }
}

function credsForm() {
  _credsForm ??= createAiCredentialsForm({
    onSaved: rerenderIfOpen,
    requestRender: rerenderIfOpen,
  });
  return _credsForm;
}

/**
 * The keyless "Connect Cloudflare" option shown beside the key form on managed platforms — the same
 * controller the assistant sidebar uses. Lazy for the same reason as the form above.
 */
let _managedConnect: ReturnType<typeof createManagedConnect> | null = null;

function managedConnect() {
  _managedConnect ??= createManagedConnect({ requestRender: rerenderIfOpen });
  return _managedConnect;
}

/**
 * The Import and Agent tabs need working AI, which a managed platform can supply without any local
 * key. Probe on every gated render so the Cloudflare option appears as soon as the backend
 * answers.
 */
function aiGateOpen(): boolean {
  if (hasAiCredentials()) {
    return true;
  }
  managedConnect().ensureProbe();
  return false;
}

/**
 * Open the New Project modal. Returns a promise that resolves with the created project info (or
 * null if cancelled).
 *
 * @param {{ tab?: NewProjectTab }} [options] Which source tab to open on; defaults to Starters.
 * @returns {Promise<{ root: string; config: object } | null>}
 */
export function openNewProjectModal(options?: { tab?: NewProjectTab }): Promise<{
  root: string;
  config: ProjectConfig;
} | null> {
  if (_handle) {
    return Promise.resolve(null);
  }
  _form = { directory: "", name: "" };
  _tab = options?.tab ?? "starter";
  _step = "source";
  _starter = "";
  _starterTouched = false;
  _agentPrompt = "";
  _error = "";
  _nameError = "";
  _errorInstallUrl = "";
  _creating = false;
  _starters = [];
  _dirDerived = true;
  resetImportTab();
  resetLocationFields();

  // Load the destination options (repo-mode owners) and starter templates in the background,
  // Re-rendering when they arrive. A platform without starters shows the scratch card alone.
  const platform = getPlatform();
  loadLocationOptions(rerenderIfOpen);
  if (platform.listStarters) {
    void platform
      .listStarters()
      .then((starters) => {
        _starters = starters;
        // Starters lead: the gallery opens with a real site selected, not an empty scaffold.
        if (!_starterTouched) {
          _starter = starters[0]?.id ?? "";
        }
        rerenderIfOpen();
      })
      .catch(() => {
        /* Non-fatal: the gallery keeps the scratch card. */
      });
  }

  return new Promise((resolve) => {
    _resolve = resolve;
    _handle = openNewProjectSurface({
      actions: {
        browse: () => {
          void browseLocation(rerenderIfOpen);
        },
        /* Escape, the Cancel button, a click on the backdrop and a programmatic close all arrive
           here, and all of them mean the same thing: nothing was created. A native `<dialog>` has
           already closed by the time it says so, which is why this settles rather than deciding
           whether to allow it — a create still in flight is dropped on the way out, exactly as a
           starter list that lands after a dismissal is. */
        closed: () => {
          settle(null);
        },
        confirm,
        pickCard: selectStarter,
        pickTab: (value) => {
          if (_creating) {
            return;
          }
          _tab = value as NewProjectTab;
          _error = "";
          redraw();
        },
        secondary: goBack,
        setAgentPrompt: (value) => {
          _agentPrompt = value;
        },
        setAiNaming: setImportAiNaming,
        setBreakpointCount,
        setBreakpointMode: (value) => {
          setBreakpointMode(value);
          redraw();
        },
        setBreakpointRounding,
        setBreakpointWidths,
        setDepth: setImportDepth,
        setImportPrompt,
        setMaxPages: setImportMaxPages,
        setMinFidelity: setImportMinFidelity,
        setName,
        setOwner: (value) => {
          setLocationOwner(value);
          redraw();
        },
        setParent: (value) => {
          setLocationParent(value);
          redraw();
        },
        setSlug,
        setUrl: (value) => {
          setImportUrl(importCtx(), value);
          redraw();
        },
        setVerify: (on) => {
          setImportVerify(on);
          // The bar below it only means anything while the check runs, so it appears with it.
          redraw();
        },
        setVisibility: (value) => {
          setLocationVisibility(value);
          redraw();
        },
      },
      islands: {
        creds: () => credsForm().render(),
        managed: () => managedConnect().render(),
        model: () => importModelHost(),
      },
      layer: layerHost("dialog"),
      view: viewOf(),
    });
  });
}

/** Push the current state at the surface — a no-op once the dialog is gone. */
function redraw(): void {
  _handle?.update(viewOf());
}

/**
 * Resolve the promise once, and take the dialog down with it.
 *
 * The promise is resolved BEFORE the dialog is closed, and the order is load-bearing rather than
 * tidy: closing raises the platform's own `close`, which arrives back here as a dismissal, so a
 * `settle` that closed first would resolve a created project's promise with `null` a frame after
 * the create succeeded. Clearing `_handle` and `_resolve` first is what makes that second pass a
 * no-op.
 */
function settle(result: { root: string; config: ProjectConfig } | null): void {
  const handle = _handle;
  const resolve = _resolve;
  _handle = null;
  _resolve = null;
  _creating = false;
  resolve?.(result);
  handle?.close();
}

/** Close the wizard and resolve its promise with a created/imported project. */
function finish(result: { root: string; config: ProjectConfig } | null) {
  settle(result);
}

/**
 * Every path out of the wizard that produced a project HERE: initialise version control for it,
 * then hand it to the caller. A scaffold is not a repository, and Delete and Rename are one click
 * away.
 *
 * The Import path does not come through here any more — `import_site` creates the project, so the
 * obligation moved with it into `services/project-adoption.ts`, which both bootstrap tools share.
 */
async function finishCreated(result: { root: string; config: ProjectConfig }) {
  await initProjectRepo(result.root);
  finish(result);
}

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

/** The human label of the chosen source, shown as context on the Name step. */
function sourceLabel(): string {
  switch (_tab) {
    case "import": {
      return "Import";
    }
    case "agent": {
      return "Agent";
    }
    default: {
      return _starter
        ? `Starter site · ${_starters.find((s) => s.id === _starter)?.name ?? _starter}`
        : "Start from scratch";
    }
  }
}

/** The import tab's context object — rebuilt per use so it closes over current state. */
function importCtx(): ImportTabCtx {
  return {
    form: _form,
    /* The wizard creates nothing on this path. `import_site` is `no-project` tiered and does the
       creating — including the git init every create path owes (`specs/desktop.md` §4.5), which
       moved into `adoptCreatedProject` with it. The modal resolves `null`, the same as a dismissal,
       because nothing was created HERE. */
    onHandoff: (brief) => {
      finish(null);
      void runImportHandoff(brief);
    },
    rerender: redraw,
    resolveDestination: () => validateParams(),
  };
}

/**
 * Validate the Name step, returning the destination to create at (null when something is missing —
 * the reason is already rendered inline and the modal re-drawn). The slug is derived from the name
 * when left blank, but the destination itself is never guessed.
 */
function validateParams(): CreateProjectDestination | null {
  if (!_form.name.trim()) {
    _nameError = "Project name is required";
    redraw();
    _handle?.focusName();
    return null;
  }
  if (!_form.directory.trim()) {
    _form.directory = deriveSlug(_form.name);
  }
  const destination = collectDestination(_form.directory);
  if (!destination) {
    _nameError = "";
    redraw();
    _handle?.focusName();
    return null;
  }
  return destination;
}

// ─── What the reader can do ───────────────────────────────────────────────────

function setName(value: string): void {
  _form.name = value;
  _nameError = "";
  // Auto-derive the directory slug from the name while the user hasn't typed one.
  if (!_form.directory) {
    _dirDerived = true;
  }
  if (_dirDerived) {
    _form.directory = deriveSlug(_form.name);
  }
  redraw();
}

function setSlug(value: string): void {
  _form.directory = value;
  _dirDerived = false;
  redraw();
}

function selectStarter(id: string): void {
  _starter = id;
  _starterTouched = true;
  _error = "";
  redraw();
}

/** The primary button: Next on the source step, the create or the hand-off on the second. */
function confirm(): void {
  if (_step === "source") {
    goNext();
    return;
  }
  if (_tab === "import") {
    handoffImport(importCtx());
    return;
  }
  /* The dialog's footer has no disabled state to give its primary (`ui.md` §5.1), so the label
     says "Creating…" and the refusal lives here. A second press during a create must not start a
     second one. */
  if (_creating) {
    return;
  }
  if (_tab === "agent") {
    void create({ template: "blank" }, async (result) => {
      // The window that opens the project consumes this and hands the prompt to the assistant.
      setPendingAgentPrompt(result.root, _agentPrompt.trim());
      await finishCreated(result);
    });
    return;
  }
  void create(_starter ? { starter: _starter } : { template: "blank" }, finishCreated);
}

function goNext(): void {
  if (_tab === "import" && !validateImportSource(importCtx())) {
    return;
  }
  if (_tab === "agent" && !_agentPrompt.trim()) {
    _error = "Describe the site you want the agent to build";
    redraw();
    return;
  }
  _step = "params";
  _error = "";
  redraw();
}

function goBack(): void {
  if (_creating) {
    return;
  }
  _step = "source";
  _error = "";
  _nameError = "";
  redraw();
}

/** Create the project from the chosen source, then run `after` with the result. */
async function create(
  source: { starter: string } | { template: string },
  after: (result: { root: string; config: ProjectConfig }) => void | Promise<void>,
): Promise<void> {
  const destination = validateParams();
  if (!destination) {
    return;
  }

  _creating = true;
  _error = "";
  _nameError = "";
  redraw();

  try {
    const result = await getPlatform().createProject({ ..._form, destination, ...source });
    await after(result);
  } catch (error) {
    _creating = false;
    captureError(error);
    redraw();
  }
}

// ─── The projection ───────────────────────────────────────────────────────────

/** Which body the document draws: the two closed gates are one sentence with two texts. */
function bodyOf(): NewProjectBody {
  if (_step === "params") {
    return "params";
  }
  if (_tab === "import") {
    return aiGateOpen() ? "import" : "gate";
  }
  if (_tab === "agent") {
    return aiGateOpen() ? "agent" : "gate";
  }
  return "starter";
}

/** The sentence above a closed gate. Both tabs need working AI; they need it for different work. */
function gateIntro(): string {
  const remedy = managedConnect().canOffer()
    ? "Connect Cloudflare, or add an OpenAI-compatible API key, to continue."
    : "Add an OpenAI-compatible API key to continue.";
  return _tab === "import"
    ? `Importing uses an AI-guided pipeline to clone an existing site. ${remedy}`
    : `The agent uses your AI provider to build the site. ${remedy}`;
}

/** The primary button's text, or `""` where there is nothing to press. */
function confirmLabel(): string {
  if (_step === "source") {
    return bodyOf() === "gate" ? "" : "Next";
  }
  if (_tab === "import") {
    return importButtonLabel();
  }
  if (_creating) {
    return "Creating…";
  }
  return _tab === "agent" ? "Create & Start Agent" : "Create Project";
}

/** The gallery: every starter the platform ships, then the one card that is not a starter. */
function cardsOf(): NewProjectCard[] {
  const cards: NewProjectCard[] = _starters.map((starter) => ({
    art: "thumb",
    id: starter.id,
    name: starter.name,
    selected: _starter === starter.id,
    tagline: starter.tagline,
    thumbnail: starter.thumbnail,
    title: starter.description,
  }));
  cards.push({
    art: "blank",
    id: "",
    name: "Start from scratch",
    selected: _starter === "",
    tagline: "An empty site with one page",
    thumbnail: "",
    title: "",
  });
  return cards;
}

/**
 * Everything the dialog draws, as one record. The only place this module's state becomes a view.
 *
 * The two sub-forms are asked for their own projections and copied out field by field rather than
 * spread: each of them calls its refusal `error`, and so does this one, and three refusals with one
 * name is exactly the kind of collision a spread resolves silently and in the wrong order.
 */
function viewOf(): NewProjectView {
  const platform = getPlatform();
  const location = locationView(_form.directory);
  const fields = importView(importCtx());
  return {
    agentPrompt: _agentPrompt,
    aiNaming: fields.aiNaming,
    body: bodyOf(),
    breakpointCount: fields.breakpointCount,
    breakpointHint: fields.breakpointHint,
    breakpointMode: fields.breakpointMode,
    breakpointModes: fields.breakpointModes,
    breakpointRounding: fields.breakpointRounding,
    breakpointWidths: fields.breakpointWidths,
    browseLabel: location.browseLabel,
    browsing: location.browsing,
    canBrowse: location.canBrowse,
    canVerify: fields.canVerify,
    cards: cardsOf(),
    confirmLabel: confirmLabel(),
    contextLabel: sourceLabel(),
    depth: fields.depth,
    destination: location.destination,
    destinationError: location.error,
    error: _error,
    errorInstallUrl: _errorInstallUrl,
    gateIntro: gateIntro(),
    headline: _step === "source" ? "Choose a starting point" : "Name your project",
    importError: fields.error,
    importPrompt: fields.prompt,
    maxBreakpoints: fields.maxBreakpoints,
    maxDepth: fields.maxDepth,
    maxPages: fields.maxPages,
    minFidelity: fields.minFidelity,
    name: _form.name,
    nameError: _nameError,
    note:
      _tab === "import"
        ? "The assistant runs the import and reports as it goes — this dialog closes as soon as it starts."
        : "The site's address, deployment target and design tokens are project settings — set them from Settings once the project is open.",
    owner: location.owner,
    owners: location.owners,
    parent: location.parent,
    parentPlaceholder: location.parentPlaceholder,
    preview: location.preview,
    previewLabel: location.previewLabel,
    repoTaken: location.repoTaken,
    roundings: fields.roundings,
    secondaryLabel: _step === "params" ? "Back" : "",
    showTabs: _step === "source",
    slug: _form.directory,
    slugLabel: location.slugLabel,
    tab: _tab,
    tabs: [
      { label: "Starters", value: "starter" },
      ...(platform.importSite ? [{ label: "Import", value: "import" }] : []),
      { label: "Agent", value: "agent" },
    ],
    url: fields.url,
    verify: fields.verify,
    visibilities: [
      { label: "Private", value: "private" },
      { label: "Public", value: "public" },
    ],
    visibility: location.visibility,
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/** The wizard's source tabs, in strip order — the declared values of `project.new`'s `tab`. */
export const NEW_PROJECT_TABS = ["starter", "import", "agent"] as const;

/**
 * Open the New Project wizard.
 *
 * `tab` is declared as an enum rather than passed through, because the two non-default tabs are AI
 * gated: naming one that does not exist would open the wizard on Starters and a shot would record
 * that as "the Import tab". The wizard resolves the returned promise when the project is created or
 * dismissed; the command deliberately does not await it — opening a modal is the action, and
 * blocking `run` until a human finishes a wizard would hold the palette open behind it.
 *
 * @returns {AnyCommand[]}
 */
export function newProjectCommands(): AnyCommand[] {
  return [
    {
      args: {
        additionalProperties: false,
        properties: {
          tab: enumProperty(NEW_PROJECT_TABS, "Which source tab to open on. Defaults to Starters."),
        },
        required: [],
        type: "object",
      },
      category: "Project",
      id: "project.new",
      level: "application",
      menus: ["commandbar/overflow", "palette"],
      group: "1_file",
      aiTool: {
        description:
          "Open the New Project wizard, optionally on the Starters, Import or Agent tab.",
        name: "open_new_project",
      },
      run: (_commandCtx, args) => {
        const tab =
          (args as { tab?: unknown }).tab === undefined
            ? undefined
            : enumArg("project.new", args, "tab", NEW_PROJECT_TABS);
        void openNewProjectModal(tab === undefined ? {} : { tab });
      },
      title: "New Project…",
    },
  ];
}

/**
 * Register the New Project verb.
 *
 * @param {CommandRegistry} registry
 */
export function registerNewProjectCommands(registry: CommandRegistry): void {
  registry.registerAll(newProjectCommands());
}
