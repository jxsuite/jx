/**
 * The six workspaces, declared where a bare Bun process can read them.
 *
 * A workspace is the answer to "what am I doing right now": designing pages, writing content,
 * managing media, editing the project's styles, publishing, or configuring the project. Studio's
 * top bar switches between the first five, and every open tab belongs to exactly one
 * (`workspace/tab-workspace.ts` derives which). Project Settings is the sixth: a workspace like the
 * others (a frame, a home tab, a place `view.setWorkspace` can name) that the top bar does not draw
 * a tab for, because it is visited for a minute from a "Project Settings" link (the gear menu, ⌘⇧,
 * and every deep link `settings.open` serves) rather than worked in (studio.md §17.1, §22.9).
 *
 * The ids live in a module with no DOM and no state for the reason `NAVIGATOR_PANEL_IDS` does:
 * `view.setWorkspace`'s `args` enum is built from {@link WORKSPACE_IDS}, and
 * `commands/app-commands.ts` must load that enum in the bare Bun process the CI checks run in. A
 * manifest step naming a workspace this list does not declare is then a red check in the PR that
 * renamed it, rather than a screenshot of the wrong screen.
 *
 * The workspace HOME tab ids are declared here too. A home is a virtual tab (a document the pane
 * draws that no file backs), and both the derivation that says which workspace a tab belongs to and
 * the module that opens one must agree on its id, so the id has one definition site that imports
 * nothing.
 *
 * @docs studio/interface
 */

/** The workspaces, in top-bar order, Settings last. ⌘1 to ⌘5 follow the switcher's five. */
export const WORKSPACE_IDS = [
  "design",
  "content",
  "media",
  "styles",
  "publish",
  "settings",
] as const;

export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

/** The workspace a project wakes up in when nothing usable is stored. */
export const DEFAULT_WORKSPACE: WorkspaceId = "design";

/** One workspace, as the top bar and the palette name it. */
export interface WorkspaceInfo {
  id: WorkspaceId;
  /** What the top-bar tab reads, and what the palette row says after "Show". */
  title: string;
  /** A key into the kit's glyph manifest (`@jxsuite/ui/icons`), checked by this module's test. */
  icon: string;
  /**
   * Whether the top bar draws a tab for it, and so whether it has a ⌘-digit chord and a "Go to"
   * palette row. False for Settings alone, which its own links and `settings.open` reach.
   */
  switcher: boolean;
}

/** Every workspace, in {@link WORKSPACE_IDS} order. */
export const WORKSPACES: readonly WorkspaceInfo[] = [
  {
    icon: "frame-corners",
    id: "design",
    switcher: true,
    title: "Design",
  },
  {
    icon: "file-text",
    id: "content",
    switcher: true,
    title: "Content",
  },
  {
    icon: "image",
    id: "media",
    switcher: true,
    title: "Media",
  },
  {
    icon: "paint-brush",
    id: "styles",
    switcher: true,
    title: "Styles",
  },
  {
    icon: "paper-plane-tilt",
    id: "publish",
    switcher: true,
    title: "Publish",
  },
  {
    icon: "gear-six",
    id: "settings",
    switcher: false,
    title: "Project settings",
  },
];

/** The workspaces the top bar draws a tab for, in order: every one but Settings. */
export const SWITCHER_WORKSPACES: readonly WorkspaceInfo[] = WORKSPACES.filter(
  (entry) => entry.switcher,
);

/** Whether a value is a declared workspace id. A stored value is untrusted input. */
export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === "string" && WORKSPACE_IDS.some((id) => id === value);
}

/** The record for a workspace id. Total over {@link WorkspaceId}. */
export function workspaceInfo(id: WorkspaceId): WorkspaceInfo {
  /* SAFETY of the `!`: WORKSPACES holds one entry per WORKSPACE_IDS member, which this module's
     test asserts in both directions. */
  return WORKSPACES.find((entry) => entry.id === id)!;
}

// ─── Workspace homes ─────────────────────────────────────────────────────────

/**
 * The scheme a workspace home's tab id carries. Not a path, so it can never collide with a file,
 * and not `grid://`, which is the grid's id space.
 */
const HOME_SCHEME = "workspace://";

/**
 * The workspaces whose home is a virtual tab of the generic home mechanism, and the canvas mode
 * that tab draws under.
 *
 * Design has no home (an empty stage is its home), and Styles' is `project.json` in its stylebook
 * editor, opened by the module that owns that document. These four are the generic mechanism's:
 * Content's home is the collection it shows (`browse/library-pane.ts`), Media's the media library,
 * Publish's its own surface, and Settings' the settings editor (`settings/settings-workspace.ts`).
 */
export const WORKSPACE_HOME_MODES = {
  content: "content-home",
  media: "media-home",
  publish: "publish-home",
  settings: "settings-home",
} as const satisfies Partial<Record<WorkspaceId, string>>;

/** A workspace whose home is a generic home tab. */
export type HomeWorkspaceId = keyof typeof WORKSPACE_HOME_MODES;

/** Whether a workspace's home is a generic home tab. */
export function isHomeWorkspace(id: WorkspaceId): id is HomeWorkspaceId {
  return Object.hasOwn(WORKSPACE_HOME_MODES, id);
}

/** The tab id of a workspace's home. */
export function workspaceHomeTabId(id: HomeWorkspaceId): string {
  return `${HOME_SCHEME}${id}`;
}

/** The workspace a home tab id names, or `null` for any other id. */
export function homeWorkspaceOfTabId(tabId: string): HomeWorkspaceId | null {
  if (!tabId.startsWith(HOME_SCHEME)) {
    return null;
  }
  const rest = tabId.slice(HOME_SCHEME.length);
  return isWorkspaceId(rest) && isHomeWorkspace(rest) ? rest : null;
}

/** The label a home tab's chip reads: the workspace's own title. `null` for any other id. */
export function workspaceHomeLabel(tabId: string): string | null {
  const id = homeWorkspaceOfTabId(tabId);
  return id ? workspaceInfo(id).title : null;
}
