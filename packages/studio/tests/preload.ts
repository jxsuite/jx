/**
 * The workspace's `bunfig.toml` preload: runs before every test file, `--isolate` included.
 *
 * It does one thing: makes DOM nodes print as one line in failure output (see
 * `@jxsuite/ui/testing/inspect-dom`). A preload rather than a line in `with-dom.ts` because about a
 * third of this suite registers happy-dom itself without going through `with-dom` or the harness,
 * and an unguarded `toBe(liveElement)` failure is what once flooded CI with 2.8 million lines. It
 * registers no window: a suite that runs without a DOM still does.
 */
import { installCompactDomInspect } from "@jxsuite/ui/testing/inspect-dom";

await installCompactDomInspect();
