/**
 * Approval-policy.ts — which of the assistant's calls Studio asks the author about first
 * (specs/ai.md §3.11).
 *
 * Undo is the backstop for an edit to a document: a tree edit runs, and one keystroke takes it
 * back. Two kinds of call have no such backstop, and those are confirmed before any of the tool's
 * code runs:
 *
 * - **A disk write that replaces a file.** `write_file`, `create_component` and `create_page` write
 *   straight to disk, which Studio's history cannot undo. Creating a file loses nothing, so only a
 *   write to a path that already holds one is put to the author.
 * - **Enabling an extension**, which installs a package from the registry into the project.
 *
 * The author may answer for the rest of the chat. That is recorded per tool in the conversation's
 * session facts, so it lasts exactly as long as the chat does and New Chat starts with none.
 *
 * @license MIT
 * @docs studio/ai/chat
 */

import { normalizeProjectPath } from "@jxsuite/ai/jx-tools";
import type { ApprovalDecision, ApprovalPolicy, SessionFacts } from "@jxsuite/ai/tools";
import { isString } from "@jxsuite/schema/guards";

/** The tools that write a whole file to disk at a path the call names. */
const DISK_WRITERS: ReadonlySet<string> = new Set([
  "write_file",
  "create_component",
  "create_page",
]);

/** The tool that installs a package. */
const INSTALLER = "enable_extension";

const PROCEED: ApprovalDecision = { kind: "proceed" };

/** The session fact that records the author's standing approval of one tool. */
export function trustFact(tool: string): string {
  return `approval.trusted:${tool}`;
}

/** What Studio's policy reads. */
export interface ApprovalPolicyDeps {
  /** The conversation's facts, read on every call: New Chat replaces them. */
  readonly session: () => SessionFacts;
  /** Whether a project-relative path already holds a file. */
  readonly fileExists: (path: string) => Promise<boolean>;
}

/**
 * Studio's approval policy: confirm a disk write that replaces a file, confirm an extension being
 * enabled, and let everything else run. A tool the author approved for this chat is not asked about
 * again.
 *
 * @param {ApprovalPolicyDeps} deps
 * @returns {ApprovalPolicy}
 */
export function studioApprovalPolicy({ session, fileExists }: ApprovalPolicyDeps): ApprovalPolicy {
  /* Answered at once for every call but a disk write to a path inside the project, which is the one
     question that has to be looked up. A call that needs no lookup starts as promptly as it did
     before there was a policy. */
  return (definition, args) => {
    const { name } = definition;
    if (session().get(trustFact(name)) === true) {
      return PROCEED;
    }
    if (name === INSTALLER) {
      const extension = isString(args.package) ? args.package : "an extension";
      return {
        kind: "confirm",
        reason: "open-world",
        summary: `Install and enable ${extension}?`,
      };
    }
    if (!DISK_WRITERS.has(name)) {
      return PROCEED;
    }
    // A path the tool will refuse anyway is the tool's to refuse, in its own words.
    const path = normalizeProjectPath(isString(args.path) ? args.path : undefined);
    if (path === null) {
      return PROCEED;
    }
    return fileExists(path).then((exists): ApprovalDecision =>
      exists ? { kind: "confirm", reason: "not-undoable", summary: `Replace "${path}"?` } : PROCEED,
    );
  };
}
