/**
 * The five workspaces, declared where a bare Bun process can read them.
 *
 * A workspace is the answer to "what am I doing right now": designing pages, writing content,
 * managing media, editing the project's styles, or publishing. Studio's top bar switches between
 * them, and every open tab belongs to exactly one (`workspace/tab-workspace.ts` derives which).
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

/** The workspaces, in top-bar order. ⌘1 to ⌘5 follow this order. */
export const WORKSPACE_IDS = ["design", "content", "media", "styles", "publish"] as const;

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
  /** One sentence saying what the workspace is FOR, the way an empty state says it. */
  purpose: string;
}

/** Every workspace, in {@link WORKSPACE_IDS} order. */
export const WORKSPACES: readonly WorkspaceInfo[] = [
  {
    icon: "frame-corners",
    id: "design",
    purpose: "Design pages, templates and components on the canvas.",
    title: "Design",
  },
  {
    icon: "file-text",
    id: "content",
    purpose: "Write and organise pages and the entries of every collection.",
    title: "Content",
  },
  {
    icon: "image",
    id: "media",
    purpose: "Upload, find and reuse the images, video, audio and documents your site uses.",
    title: "Media",
  },
  {
    icon: "paint-brush",
    id: "styles",
    purpose: "Set the colours, fonts and element defaults every page shares.",
    title: "Styles",
  },
  {
    icon: "paper-plane-tilt",
    id: "publish",
    purpose: "Review your changes and put them on the live site.",
    title: "Publish",
  },
];

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
 * editor, opened by the module that owns that document. These three are the generic mechanism's:
 * Content's home is the collection it shows (`browse/library-pane.ts`), Media's the media library,
 * and Publish's its own surface.
 */
export const WORKSPACE_HOME_MODES = {
  content: "content-home",
  media: "media-home",
  publish: "publish-home",
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
