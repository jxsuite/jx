/**
 * Shared fixtures for the workspace suites: a tab over a path (or a virtual id), in a given editor.
 *
 * Not a test file. The workspace rules read a tab's id, its path and its canvas mode, so every
 * suite about them opens tabs the same way; one helper keeps the shape of that tab in one place.
 */
import { openTab } from "../src/workspace/workspace";
import type { Tab } from "../src/tabs/tab";

/** Options for {@link openStubTab}: the document path (`null` for a virtual tab) and the editor. */
export interface StubTabOptions {
  path?: string | null;
  mode?: string;
}

/** Open a stub tab with `id` in the focused pane, in `mode` when one is given. */
export function openStubTab(id: string, opts: StubTabOptions = {}): Tab {
  const opened = openTab({
    document: { children: [], tagName: "div" },
    documentPath: opts.path === undefined ? id : opts.path,
    id,
    ...(opts.mode !== undefined && { capabilities: { modes: [opts.mode] } }),
  });
  if (opts.mode !== undefined) {
    opened.session.ui.canvasMode = opts.mode;
  }
  return opened;
}

/** The workspace a fresh virtual tab of `id` in `mode` belongs to: `openStubTab` with no path. */
export function openVirtualTab(id: string, mode: string): Tab {
  return openStubTab(id, { mode, path: null });
}
