/**
 * The workspace's `bunfig.toml` preload: runs before every test file, `--isolate` included.
 *
 * It does one thing: makes DOM nodes print as one line in failure output (see
 * `src/testing/inspect-dom.ts`), so a failing `toBe(liveElement)` names the element instead of
 * walking its reactive state into the log. It registers no window: a suite that runs without a DOM
 * still does.
 */
import { installCompactDomInspect } from "../src/testing/inspect-dom.ts";

await installCompactDomInspect();
