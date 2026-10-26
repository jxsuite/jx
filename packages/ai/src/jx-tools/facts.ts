/**
 * What each of the Jx assistant's tools does to the world (specs/ai.md §3.10), as data: the four
 * behaviour hints, and the one effect a host's undo and approvals are decided by.
 *
 * Keyed by tool name rather than carried by each tool's module so one table can be read and
 * reviewed whole, and so a tool that has none is a test failure rather than a silent default.
 *
 * @module @jxsuite/ai/jx-tools
 * @license MIT
 */

import type { ToolAnnotations } from "../tools.ts";

/**
 * Where a tool's change lands: nowhere (`none`), in the host's view (`ui`), in the open document
 * (`document`, which its history can undo), in the project's configuration (`project`, likewise),
 * or straight on disk (`disk`, which nothing undoes).
 */
export type ToolEffect = "none" | "ui" | "document" | "project" | "disk";

/** One tool's facts. */
export interface ToolFacts {
  readonly annotations: ToolAnnotations;
  readonly effect: ToolEffect;
}

/** Facts from the hints in the order MCP names them: read-only, destructive, idempotent, open-world. */
function facts(
  readOnlyHint: boolean,
  destructiveHint: boolean,
  idempotentHint: boolean,
  openWorldHint: boolean,
  effect: ToolEffect,
): ToolFacts {
  return { annotations: { destructiveHint, idempotentHint, openWorldHint, readOnlyHint }, effect };
}

const INTERACTION = facts(true, false, false, false, "none");
const READ = facts(true, false, true, false, "none");
const DISK_OVERWRITE = facts(false, true, true, false, "disk");
const BOOTSTRAP = facts(false, false, false, true, "disk");
const TREE_IDEMPOTENT = facts(false, false, true, false, "document");
const TREE = facts(false, false, false, false, "document");
const UI = facts(false, false, true, false, "ui");
const PROJECT = facts(false, false, true, false, "project");

/** Every tool the Jx assistant offers, by name. */
export const JX_TOOL_FACTS = {
  add_child: TREE,
  /* Creates a file under a name the arguments choose, and refuses one that exists: never an
     overwrite, but not a call to repeat either. */
  add_new: facts(false, false, false, false, "disk"),
  add_project_locale: PROJECT,
  add_state: TREE_IDEMPOTENT,
  ask_user: INTERACTION,
  check_accessibility: READ,
  check_popovers: READ,
  create_component: DISK_OVERWRITE,
  create_page: DISK_OVERWRITE,
  create_project: BOOTSTRAP,
  delete_node: facts(false, true, false, false, "document"),
  disable_extension: PROJECT,
  duplicate_node: TREE,
  // Installs a package, which reaches the registry and which undo cannot take back.
  enable_extension: facts(false, true, true, true, "disk"),
  import_site: BOOTSTRAP,
  list_files: READ,
  list_starters: READ,
  move_node: TREE,
  open_document: UI,
  read_document: READ,
  read_file: READ,
  search_files: READ,
  select_node: UI,
  set_canvas_mode: UI,
  set_property: TREE_IDEMPOTENT,
  set_style: TREE_IDEMPOTENT,
  set_text: TREE_IDEMPOTENT,
  update_state: TREE_IDEMPOTENT,
  validate_redirects: READ,
  write_file: DISK_OVERWRITE,
} satisfies Readonly<Record<string, ToolFacts>>;

/** The name of a tool the Jx assistant offers. */
export type JxToolName = keyof typeof JX_TOOL_FACTS;

/**
 * The facts of the tool named `name`, or undefined for a name the table does not know.
 *
 * @param {string} name
 * @returns {ToolFacts | undefined}
 */
export function toolFacts(name: string): ToolFacts | undefined {
  /* SAFETY: `Object.hasOwn` has just proven `name` is one of the table's own keys. */
  return Object.hasOwn(JX_TOOL_FACTS, name) ? JX_TOOL_FACTS[name as JxToolName] : undefined;
}
