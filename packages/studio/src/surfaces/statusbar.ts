/// <reference lib="dom" />
/**
 * The status bar — ambient state, in scope order, and the breadcrumb trail between it.
 *
 * What this replaces: a bar built by `innerHTML` string concatenation with a three-character
 * escaper, carrying whatever the last of 78 `statusMessage()` calls had said, for three seconds.
 * Transient messages have left entirely for the toast host (`ui/layers.ts`) and the Problems list
 * (`services/notify.ts`); what remains here is state that is TRUE for as long as it is shown.
 *
 * **Three fields, in the shell's own left-to-right level order** (§16.2), so the bar restates the
 * containment model on every glance:
 *
 * ```text
 * PROJECT                        ‖ DOCUMENT                           ‖ SELECTION
 * name · branch ↑n↓n · problems  ‖ file › ancestor › … › element ⌃     ‖ count · style rule
 * ```
 *
 * **The DOCUMENT field is the jump bar** (`panels/jump-bar.ts`): the focused pane's address, every
 * step a button that selects it. This module renders the fields either side of it and leaves the
 * middle as an empty `trail` slot, which the jump bar is handed once this document has mounted. The
 * field used to hold the file path, the view name and a save word; the trail's first step is the
 * same file path with the same `palette.openFiles` command, the view is the pane context bar's (a
 * second copy at 11px is the chrome duplication studio-ui-guidelines.md §12.2's budget exists to
 * prevent), and unsaved changes are stated by the tab strip's dirty marker and the Command Bar's
 * Save. A trail of ancestors is worth more on this row than any of the three.
 *
 * `statusbar/project`, `statusbar/document` and `statusbar/selection` are three placements the
 * level × placement matrix already declares, each admitting exactly one level — so the bar's
 * mixedness is structural rather than an exemption.
 *
 * **Every interactive item is a command.** There are no click handlers in this file: an item names
 * a command id, and renders as a button only when the registry has that command and its `when`
 * holds. That is what let an item with no command yet — the peers count, before the `Collaborate:`
 * family was registered — sit in the template and start rendering the day its command arrived, with
 * no edit here. The one readout that is NOT a button is the stylebook selector.
 *
 * The bar is the `statusbar` surface (`surfaces/statusbar.json`): this module is the projection —
 * fields of items, each item a button with a command or a readout without — and the surface draws
 * it. The scope is reactive, so one effect recomputes the projection from the state the bar
 * renders; nothing repaints.
 *
 * @docs studio/interface
 */

import { projectState, statusbarEl } from "../store";
import { attachJumpBarHost, mountJumpBar, unmountJumpBar } from "../panels/jump-bar";
import { shell } from "../shell";
import { effect, effectScope, reactive } from "../reactivity";
import { activeTab } from "../workspace/workspace";
import { activeRegistry } from "../commands/active-registry";
import { runReported } from "../commands/run-reported";
import { deployStatusItem } from "../publish/deploy-checklist";
import { collabState } from "../collab/collab-state";
import { problemCount, problems } from "../services/notify";
import { mountSurface, registerSurface } from "../ui/surface";
import statusbarDoc from "./statusbar.json";
import type { CommandRegistry } from "../commands/registry";
import type { EffectScope } from "@vue/reactivity";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("statusbar", statusbarDoc as unknown as JxDocument);

let _scope: EffectScope | null = null;

// ─── Items ───────────────────────────────────────────────────────────────────

/** One thing the bar can show. A `command` makes it a button; without one it is a readout. */
interface StatusItem {
  /** Command id, or `null` for a pure readout. */
  command: string | null;
  label: string;
  /** Extra context for the tooltip. The command's own title and chord are added to it. */
  title?: string;
  args?: Record<string, unknown>;
}

/** One item as the surface reads it: a button that runs a command through `run`, or a readout. */
interface ProjectedItem {
  /** Unique within the bar; the row's identity and what `run` receives. */
  key: string;
  kind: "button" | "state";
  label: string;
  title: string;
  disabled: boolean;
  /** For a button: what `run` runs. */
  command: string | null;
  args: Record<string, unknown> | undefined;
}

interface ProjectedField {
  id: string;
  region: string;
  items: ProjectedItem[];
}

/**
 * Project one item.
 *
 * A named command that the registry does not have, or whose `when` is false, projects to NOTHING —
 * the item disappears rather than becoming a dead label. That is the whole mechanism by which the
 * bar stays a rendering of the registry instead of a second place capabilities are decided.
 */
function projectItem(
  registry: CommandRegistry | null,
  region: string,
  item: StatusItem,
): ProjectedItem | null {
  if (item.command === null) {
    return {
      args: undefined,
      command: null,
      disabled: false,
      key: `${region}:${item.label}`,
      kind: "state",
      label: item.label,
      title: item.title ?? item.label,
    };
  }
  const id = item.command;
  if (!registry?.get(id) || !registry.isVisible(id)) {
    return null;
  }
  const command = registry.get(id)!;
  const reason = registry.disabledReason(id);
  const chord = registry.keymap.formatBinding(id);
  const suffix = reason
    ? `${command.title} — requires ${reason}`
    : chord
      ? `${command.title} (${chord})`
      : command.title;
  return {
    args: item.args,
    command: id,
    disabled: reason !== undefined,
    key: `${region}:${id}`,
    kind: "button",
    label: item.label,
    title: item.title ? `${item.title} · ${suffix}` : suffix,
  };
}

/** A field, with its region. Absent when it has no items. */
function projectField(
  registry: CommandRegistry | null,
  id: string,
  items: readonly (StatusItem | null)[],
): ProjectedField | null {
  const region = `statusbar/${id}`;
  const live = items
    .map((item) => (item === null ? null : projectItem(registry, region, item)))
    .filter((item): item is ProjectedItem => item !== null);
  if (live.length === 0) {
    return null;
  }
  return { id, items: live, region };
}

// ─── PROJECT ─────────────────────────────────────────────────────────────────

/** `↑2↓1`, or "" when the branch is level with its upstream. */
export function aheadBehindLabel(ahead: number, behind: number): string {
  return `${ahead > 0 ? ` ↑${ahead}` : ""}${behind > 0 ? ` ↓${behind}` : ""}`;
}

function projectField_(registry: CommandRegistry | null): ProjectedField | null {
  const project = projectState;
  const { status } = shell.git;
  const count = problemCount();
  const deploy = deployStatusItem();
  const peers = activeTab.value ? collabState(activeTab.value).peers.length : 0;
  return projectField(registry, "project", [
    project
      ? { command: "project.openRecent", label: project.name }
      : { command: "project.open", label: "No project" },
    /* WHICH branch, when there is one — and deliberately no "not tracked" twin, though the shell
       redesign's "repo state becomes a persistent status-bar field" reads like a request for one.
       An untracked project already states itself in this field, one item along:
       `deployStatusItem()`'s first link is `repo`, whose label is "Track this project with git" and
       whose command is `git.init`. A second item beside it would carry no fact the first does not
       — "Not tracked" and "Track this project with git" answer the same question with the same verb
       — and adjacent duplicate chrome is what the chrome budget (studio-ui-guidelines.md §12.2)
       forbids. `tests/statusbar.test.ts` pins the pairing from both ends, so deleting the
       checklist's repo step fails there rather than quietly taking the state off the bar. */
    status?.isRepo === true && status.branch
      ? {
          command: "panel.focus.git",
          label: `⑂ ${status.branch}${aheadBehindLabel(status.ahead, status.behind)}`,
          title: `${status.files.length} changed file(s)`,
        }
      : null,
    // Where the project stands with shipping — ambient state, so it belongs beside the branch and
    // The problem count rather than in a toast. `deployStatusItem` names the NEXT missing step
    // While anything is missing, and the deployment itself once nothing is.
    deploy ? { command: deploy.command, label: deploy.label, title: deploy.title } : null,
    // `view.setBottomTab`, not `panel.focus.problems`: the latter is generated from the rail
    // Roster, and Problems left the rail. That is the same verb Diff, Logic and Activity are
    // Addressed by — one door per bottom tab — and it is what keeps this readout the ONLY standing
    // Mention of problems in the chrome, which is the point of taking the rail button away.
    count > 0
      ? {
          args: { tab: "problems" },
          command: "view.setBottomTab",
          label: `⚠ ${count}`,
          title: `${count} problem(s)`,
        }
      : null,
    /* `collab.showStatus` — "what is happening in this document?" — because that is the question a
       peer count raises. An id is not a stable interface between two files unless something checks
       it, which is what `tests/statusbar.test.ts` does. */
    peers > 0
      ? {
          command: "collab.showStatus",
          label: `${peers} peer${peers === 1 ? "" : "s"}`,
          title: `${peers} peer${peers === 1 ? "" : "s"} in this document`,
        }
      : null,
  ]);
}

// ─── SELECTION ───────────────────────────────────────────────────────────────

/**
 * What is selected — the COUNT, and nothing that is an address.
 *
 * The ancestor trail is the DOCUMENT field to its left (`panels/jump-bar.ts`). What is left here is
 * what a trail CANNOT say, and both are ambient state in the §16.2 sense: how many things are
 * selected (a count is not a path, and the jump bar names only the primary), and which style rule
 * the Stylebook is editing (a CSS selector is not a node in this document).
 *
 * A single selection therefore leaves this field empty. That is deliberate — the trail's leaf
 * states it permanently, with its ancestors, one field to the left.
 */
function selectionField(registry: CommandRegistry | null): ProjectedField | null {
  const paths = activeTab.value?.session.selection ?? [];
  if (paths.length > 0) {
    // A document selection owns the field even when it prints nothing: the Stylebook's selector
    // Below would otherwise appear while an element is picked, which is two answers to one question.
    return paths.length > 1
      ? projectField(registry, "selection", [
          {
            command: null,
            label: `${paths.length} selected`,
            title: `${paths.length} elements are selected; the trail names the primary`,
          },
        ])
      : null;
  }
  // The stylebook's own selection is a selection: it is what the Style panel is editing, and it is
  // The only thing in this field when no document node is picked.
  return shell.stylebook.selection
    ? projectField(registry, "selection", [
        {
          command: null,
          label: shell.stylebook.selection.replaceAll(" ", " › "),
          title: "The style rule being edited",
        },
      ])
    : null;
}

// ─── The bar ─────────────────────────────────────────────────────────────────

/** Drop the absent fields. */
function present(fields: readonly (ProjectedField | null)[]): ProjectedField[] {
  return fields.filter((field): field is ProjectedField => field !== null);
}

interface StatusbarScope extends Record<string, unknown> {
  /** The fields before the DOCUMENT slot: PROJECT. */
  leading: ProjectedField[];
  /** Whether the DOCUMENT slot has a trail to show. */
  hasDocument: boolean;
  /** The fields after it: SELECTION. */
  trailing: ProjectedField[];
  run: (key: string) => void;
}

let _state: StatusbarScope | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _handle: SurfaceHandle | null = null;

/** The reactive scope the surface reads, made once. */
function state(): StatusbarScope {
  _state ??= reactive({
    hasDocument: false,
    leading: [],
    run: (key: string) => {
      const item = [...(_state?.leading ?? []), ...(_state?.trailing ?? [])]
        .flatMap((field) => field.items)
        .find((i) => i.key === key);
      const registry = activeRegistry();
      if (item?.command && registry) {
        void runReported(registry, item.command, item.args as never, "Status Bar");
      }
    },
    trailing: [],
  }) as StatusbarScope;
  return _state;
}

/**
 * Mount the surface into the bar's host, once, and hand its DOCUMENT slot to the jump bar.
 *
 * The slot is a box this document draws empty; the jump bar mounts its own document into it, which
 * is the same hand-over the pane grid gives the tab strip and the context bar.
 */
function ensureMounted(): void {
  if (_mount || !statusbarEl) {
    return;
  }
  const mount = mountSurface("statusbar", state(), statusbarEl);
  _mount = mount;
  void mount.then((handle) => {
    if (_mount !== mount) {
      return;
    }
    _handle = handle;
    attachJumpBarHost(statusbarEl.querySelector<HTMLElement>('[part="trail"]'));
  });
}

/**
 * Recompute the projection; the surface follows. Exported because the bootstrap paints once before
 * mounting the effect.
 */
export function renderStatusbar(): void {
  const registry = activeRegistry();
  const scope = state();
  scope.leading = present([projectField_(registry)]);
  scope.hasDocument = activeTab.value !== null;
  scope.trailing = present([selectionField(registry)]);
  ensureMounted();
}

/**
 * Subscribe the bar to the state it renders, and its DOCUMENT field's trail with it. Idempotent.
 *
 * The trail is this bar's field, so this bar owns its lifecycle: the jump bar's effect starts here
 * and stops in {@link unmountStatusbar}, and its host arrives from {@link ensureMounted}.
 */
export function mountStatusbar(): void {
  unmountStatusbar();
  mountJumpBar();
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // The registry is composed AFTER the bootstrap mounts this, and it is a reactive holder —
      // Reading it here is what repaints the bar from a skeleton into the real thing.
      void activeRegistry();
      void shell.stylebook.selection;
      void shell.git.status;
      void problems.length;
      const tab = activeTab.value;
      if (tab) {
        void tab.session.selection.length;
        void collabState(tab).peers.length;
      }
      renderStatusbar();
    });
  });
}

export function unmountStatusbar(): void {
  _scope?.stop();
  _scope = null;
  const pending = _mount;
  _mount = null;
  unmountJumpBar();
  if (_handle) {
    _handle.dispose();
    _handle = null;
  } else if (pending) {
    void pending.then((handle) => handle.dispose());
  }
  _state = null;
}
