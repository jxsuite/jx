/**
 * Fixture values more than one suite builds on.
 *
 * Plain data and nothing else: importing this module installs no DOM, registers no platform and
 * mocks no module, so any suite (a DOM one or a bare-Bun one) can read it at any point. A suite
 * that changes one of these values for its own case copies it first; every one is shared, and `bun
 * test --isolate` gives each FILE a fresh module, not each test.
 */

import type { CaptureRuntime } from "../../../scripts/check-image-lock";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { OfferedAction, RepoInfo } from "../src/types";
import type { ComponentEntry } from "../src/files/components";

// ─── Components ───────────────────────────────────────────────────────────────

/**
 * One project component with a prop default — what the Site panel, the Insert panel's click and the
 * slash menu's Components group insert and import (specs/studio.md §5.7).
 */
export const SITE_CARD: ComponentEntry = {
  path: "components/site-card.json",
  props: [{ default: "Hi", name: "heading" }],
  source: "project",
  tagName: "site-card",
};

// ─── Accounts ─────────────────────────────────────────────────────────────────

/** Where the account-status fixtures say the GitHub App installs from. */
export const INSTALL_URL = "https://github.com/apps/jx-suite/installations/new";

/** A platform offer to join a team, as an action-required notice carries it. */
export const JOIN_OFFER = {
  href: "https://example.test/join",
  id: "join",
  label: "Join",
  primary: true,
} satisfies OfferedAction;

/** The same offer without the primary flag, as a secondary link. */
export const JOIN_LINK = {
  href: "https://example.test/join",
  id: "join",
  label: "Join",
} satisfies OfferedAction;

/** Two repositories a GitHub listing answers: a Jx project with admin rights, and a plain one. */
export const REPOS: RepoInfo[] = [
  {
    defaultBranch: "main",
    fullName: "octocat/site",
    isJxProject: true,
    name: "site",
    owner: "octocat",
    permission: "admin",
    private: true,
  },
  {
    defaultBranch: "trunk",
    fullName: "acme/marketing",
    isJxProject: false,
    name: "marketing",
    owner: "acme",
    permission: "write",
    private: false,
  },
];

// ─── Documents ────────────────────────────────────────────────────────────────

/** A root with no children. */
export const EMPTY_DOC: JxMutableNode = { children: [], tagName: "div" };

/** A root holding one paragraph that reads "Hi". */
export const PARAGRAPH_DOC: JxMutableNode = {
  children: [{ tagName: "p", textContent: "Hi" }],
  tagName: "div",
};

/** A root holding two paragraphs, "A" and "B". */
export const TWO_PARAGRAPHS: JxMutableNode = {
  children: [
    { tagName: "p", textContent: "A" },
    { tagName: "p", textContent: "B" },
  ],
  tagName: "div",
};

/** A button that opens a modal dialog by invoker command, and the dialog it opens (holding a link). */
export const DIALOG_DOC: JxMutableNode = {
  children: [
    { attributes: { command: "show-modal", commandfor: "d" }, tagName: "button" },
    {
      attributes: { id: "d" },
      children: [{ attributes: { href: "/a" }, tagName: "a" }],
      tagName: "dialog",
    },
  ],
  tagName: "div",
};

/** A project `content` section with one Markdown collection, `posts`. */
export const POSTS = { posts: { format: "Markdown", source: "./content/posts/" } };

// ─── Selections ───────────────────────────────────────────────────────────────

/** The first and second children of the root: the pair a multi-selection test selects. */
export const A = ["children", 0];
export const B = ["children", 1];

/** The template of a repeater that is the root's second child. */
export const MAP_TEMPLATE = ["children", 1, "map"];

// ─── Windowed lists ───────────────────────────────────────────────────────────

/** The height a windowed tree's scroller is stubbed to, in pixels. */
export const VIEWPORT = 240;

/** How many rows a windowed tree is filled with: far more than {@link VIEWPORT} shows. */
export const CHILD_COUNT = 200;

/** The comfortable row height, in pixels. */
export const COMFORTABLE = 28;

/** How many pages the Library performance fixtures scan. */
export const PAGE_COUNT = 300;

/** The Library pane's stubbed size. */
export const LIBRARY_VIEWPORT = { height: 700, width: 1180 };

// ─── Screenshots ──────────────────────────────────────────────────────────────

/** The capture runtime an image lock entry records in these fixtures. */
export const RUNTIME: CaptureRuntime = {
  chromium: "141",
  fontset: "fc:abc123",
  os: "ubuntu-24.04",
};

/** The shot-contract fixture manifests, relative to the repository root. */
export const FIXTURES = "scripts/screenshots/fixtures/contract";
