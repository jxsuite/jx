/**
 * The shared `bun test` preload. Every workspace whose tests use happy-dom names it in its
 * `bunfig.toml` (`preload = ["@jxsuite/test-support/preload"]`), and it runs before every test
 * file, `--isolate` included. It registers no window, so a file that runs without a DOM still
 * does.
 *
 * Three things, each because the default cost a CI run once:
 *
 * 1. DOM nodes print as one line in failure output (`inspect-dom.ts`), so a failing
 *    `toBe(liveElement)` names the element instead of walking its reactive graph into the log.
 * 2. Deep equality on a DOM node is refused before Bun's diff printer runs (`dom-equality.ts`), so a
 *    failing `toEqual(liveElement)` fails at once instead of hanging the job.
 * 3. A local Bun that is not CI's pinned one says so, once (`bun-pin.ts`).
 *
 * @docs extending/contributing/monorepo
 */
import { expect } from "bun:test";

import { MARKER_DIR, readPinnedBunVersion, warnOnBunMismatch, writeStderr } from "./bun-pin.ts";
import { installDomEqualityGuard, instanceOf } from "./dom-equality.ts";
import { installCompactInspect, loadHappyDom } from "./inspect-dom.ts";

const { Node } = await loadHappyDom();
installCompactInspect(Node.prototype);
installDomEqualityGuard(expect, instanceOf(Node));
warnOnBunMismatch({
  local: Bun.version,
  markerDir: MARKER_DIR,
  now: Date.now(),
  pid: process.pid,
  pinned: readPinnedBunVersion(),
  write: writeStderr,
});
