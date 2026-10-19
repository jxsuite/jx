# Studio performance: interaction tracing and responsiveness plan

**Status:** baseline audit, September 2026; the CI gate became a same-runner A/B in October 2026 (see The regression gate).\
**Tooling:** `scripts/perf/trace-studio.ts` (CDP trace driver) + `scripts/perf/sources.ts` (source-map attribution) + `scripts/perf/analysis.ts` (trace analytics).\
**Subject:** Jx Studio dev build served by the bundling dev server, driven through the app's own automation surface (`window.__jxAutomation`, `?automation=1`), headless Chrome on NixOS (NVMe, dev-machine class).

## The regression gate

##### Why a pull request is judged A/B, not against `baseline.json`

The gate used to compare a pull request's run on a CI runner against `scripts/perf/baseline.json`, a file recorded on a dev machine in September. That measured the machine, not the change. On PR #466 every scenario but one read 37 to 95% FASTER than the baseline (the runner is quieter than the workstation the file came from), while `settings` read `220 → 439 ms (+100%)` and `grid-edit`/`panels` scripting flagged `+271%`/`+367%` on 0.7 → 2.6 ms and 2.1 → 9.8 ms. A real regression and the machine difference sat in the same table with no way to tell them apart, and the tiny-metric rows were noise that a percentage made look like news.

##### How the A/B gate works (`--base-url`)

On a pull request, `.github/workflows/studio-perf.yml` checks out the PR's merge base into a second worktree (`git worktree add` of `git merge-base origin/<target> HEAD`), installs and builds it, and serves base and head from two dev servers (`JX_DEV_PORT` 3001 and 3000). `trace-studio.ts --url <head> --base-url <base>` then:

1. Opens one headless Chrome per side FOR EACH SCENARIO (a fresh profile, so neither renderer carries what an earlier scenario did) and loads each build's Studio on its own copy of `sites/jxsuite.com`. The dev servers run with `JX_DEV_WATCH=0`, so no file written under the root mid-run can rebuild a bundle or live-reload a page being traced.
2. Runs every scenario's repetitions **interleaved**: rep 0 is base then head, rep 1 head then base, and so on (`abOrder`). Whatever the runner does during a scenario (a noisy neighbour, a thermal trend, a GC debt) is paid by both builds, and neither always runs right after the other.
3. Reports, per scenario and metric (wall, main-thread work, and its three components: app scripting, style recalc, layout), each side's median and `[min–max]` across reps, the head/base ratio, and a one-sided exact Mann-Whitney p-value.
4. Fails only on `wallMs` and `mainThreadMs` (scripting + style + layout), the two things an interaction costs the person using it (`GATED_METRICS`). The components are compared on the same bars and marked `up (diagnostic)` when they cross them, but do not fail on their own: they trade against each other, and the third CI run of PR #466 read `canvas-edit` as wall x0.98 and scripting -28 ms with style recalculation +34 ms (x1.78), a red X on a change that made the interaction faster (the Inspector now follows the selection to its Page tab, studio.md §6, so a deselect restyles the Page panel where base stayed put). Four gated metrics per scenario was also four chances at a p < 0.05 false positive. A gated metric fails only when ALL of these hold (`compareAB`): base's median is at least 5 ms (the `MIN_BASELINE_MS` floor kept from the absolute gate: below it a ratio is noise, and `wallMs` still guards the scenario); head's median exceeds base's by more than 20%; and by more than 25 ms; and the reps separate at p < 0.05.

Why Mann-Whitney: interaction timings are right-skewed and carry the odd outlier rep. A rank test assumes no distribution, uses every rep rather than two medians, and one wild rep moves its statistic by at most one sample's worth, so a single outlier can neither manufacture a regression nor hide one. The test is exact (the whole U distribution is enumerated), which keeps it honest at the five reps per side a CI budget allows: the smallest p it can produce there is 1/252. At three reps per side the smallest is 1/20 = 0.05, which can never clear the bar, so the A/B mode refuses fewer than four (`MIN_AB_REPS`).

A scenario the base cannot run (its `requires` command is missing, which is how a new feature's scenario looks) is traced on head and held to an absolute ceiling instead: `scripts/perf/budgets.json` (median wall and median longest main-thread task, generous on purpose, per-scenario overrides allowed). The same downgrade applies when base declares the command but cannot reach the state the scenario measures, which a scenario's setup says by throwing `ScenarioUnavailableError`: `grid-edit` requires the `docs` grid to draw rows before it is timed, because on `main` before the workspaces redesign the collection resolver put `"source": "../../docs"` under the site, every listing was a 500 and the grid was an empty table, so an A/B of it compared an empty table with head's sixty rows and read the row rendering as `grid-edit` wall 664 → 851 ms (+28%) and style recalculation 92 → 157 ms. On head that error fails the scenario like any other throw. The downgrade is ONLY for those two. Every other way of not comparing fails the gate, each with its own row and a `::error::` annotation (`classifyScenario`): a scenario that throws on head (`head-failed`), one that throws on a base that declares what it needs (`base-failed`, which is how a broken base build or an unresolvable base project shows up, rather than as a quiet pass against the budget), one whose `requires` command head no longer declares (`head-missing`, so unregistering a command cannot drop the scenarios that drive it), and a run that judged no scenario at all. A `--scen` name that matches no scenario is a usage error before any Chrome starts. For each regressed metric the log prints the hottest original sources of the head rep nearest head's median beside base's, so the failure names code. The Markdown table goes to the job summary (`--summary`), and `ab.json`, with every rep of every metric, is uploaded as the `studio-perf-results` artifact.

Proving it catches a change: an 80 ms busy loop injected into `palette.open` (three opens per rep) read `palette` wall 334 → 588 ms (×1.76) and scripting 40.5 → 282 ms (×6.96), both p = 0.004, with the injected chunk's `run` at the top of head's hot frames, while the untouched `palette-files` beside it read ×1.00 and ×0.97. That run also found a harness gap: the harness ran each command inside `Runtime.evaluate`, which Chrome executes in a `Receive mojo message` task with no scripting slice around it, so a command's whole synchronous part was missing from `scripting` (the same injection first moved wall by 255 ms and scripting by nothing). `runCommand` now dispatches from a timer task (`commandExpression`), where the work lands under `TimerFire` as a user gesture's lands under `EventDispatch`.

##### The nightly trend run, and adopting a baseline

The schedule (and `workflow_dispatch`) keeps the absolute comparison against `scripts/perf/baseline.json` for drift on `main`, and every such run also re-captures a baseline FROM THE RUNNER (`--write-baseline 1 --baseline-out`), uploaded in the same artifact. `baseline.json` is (re)written only from that artifact, never from a dev machine. To adopt one: open a green nightly or a manual `workflow_dispatch` run of Studio Perf on `main`, download `studio-perf-results`, copy its `baseline.json` over `scripts/perf/baseline.json`, and land it in a pull request that names the run. A baseline records the analyzer version it was captured under (`analyzerVersion`, `ANALYZER_VERSION` in `trace-studio.ts`, bumped whenever `analysis.ts` changes what a metric counts), and `--compare` gates only against a baseline of the current version: numbers from two definitions are not the same quantity, so comparing them would red on the definition change and pass on the old definition's slack. The tracked file is still the September dev-machine capture, which predates the field and so reads as version 1 against the main-thread self-time analyzer's version 2, so until a runner capture is adopted the nightly is report-only (a `::warning::`, the table, no exit code), and every scenario without a baseline row is listed as `not in baseline` rather than skipped. The pull-request gate does not read the file at all.

##### Running the A/B locally

Serve both builds on ports other than 3000, so your own dev server stays out of it: `JX_DEV_PORT=3101 bun run dev` in this checkout, and the base in another directory (for example `git archive $(git merge-base HEAD origin/main) | tar -x -C .cache/perf-base`, then `bun install`, `bun run build:studio` and `JX_DEV_PORT=3102 bun run dev` there). Then:

```
bun scripts/perf/trace-studio.ts \
  --url "http://127.0.0.1:3101/packages/studio/index.html?project=$PWD/sites/jxsuite.com/project.json&automation=1" \
  --base-url "http://127.0.0.1:3102/packages/studio/index.html?project=$PWD/.cache/perf-base/sites/jxsuite.com/project.json&automation=1"
```

The two Chromes take `--port` and `--port + 1` (default 9226 and 9227). Set `CHROME_BIN` where Chrome is not `google-chrome-stable`.

## How the framework works

##### Trace driver

`bun run perf:studio` launches a throwaway headless Chrome `--remote-debugging-port` profile, opens the studio with a project, and drives real UI surfaces via `__jxAutomation.run(...)`, typed-key insertion through Chrome input events, and `probe.idle()` quiescence between steps — the same command registry a user gesture goes through. The framework never touches selectors; every step is a named command, which is exactly what spec studio §13.5 asks a script to be able to reach.

##### Scenarios

Canned interaction scenarios ship in `SCENARIOS` (the list below is the September set; the workspaces redesign added `workspaces`, `site-panel`, `content`, `media`, `styles`, `publish`, `add-new`, `quick-publish` and `inspector-page`, each with a `requires` command so a build without workspaces skips it by name): `boot` and `document-boot` (navigation → idle, without and with `?file=pages/index.md`), `assistant`, `canvas-edit` (selection and Inspector-tab cycling on an open document), `palette`, `palette-files`, `grid-edit` (the collection's data grid, via `collection.editInGrid` over the traced site's own `docs` collection — read-only), `regions`, `panels`, and `settings`. Each runs N repetitions (`--reps`; the MEDIAN repetition by active engine time is reported — see Reporting the median in the shipped section), records a DevTools timeline per repetition over the categories that also power the DevTools Performance panel (`devtools.timeline`, `toplevel`, `v8.execute`, CPU profiler, stack + invalidation tracking), fires real palette filters through Chrome input events, and writes results to a `/tmp` trace directory (default; `--out` overrides) so the dev server's tree-watching rebuild lane never sees a trace artifact; the raw event stream for a scenario can be dumped with `--dump 1`. A scenario may declare an untraced `setup` that puts the app in its own starting state before each repetition (`canvas-edit`, `grid-edit` and `panels` open `pages/index.md` there).

##### Attribution

The analytics in `scripts/perf/analysis.ts` bucket timeline events into scripting / rendering (style recalc + layout) / painting / GC / loading, harvest `FunctionCall` totals per bundle location, then resolve those bundle locations back to original `packages/*` source locations by walking the bundle's source map (`scripts/perf/sources.ts`). Style recalculations with no recorded call stack are joined to the nearest `StyleRecalcInvalidationTracking` record (reason + caller), which is what turns "some style recalc got slow" into "X invalidated N nodes".

##### Known limits

The tracer's own `probe.idle()` wait loop bills ~100–300 ms of scripting to each scenario; `trace-studio.ts` now attributes that cost through the same source-map pass (sources under `src/services/idle.ts` are the harness's rAF poll) and **subtracts it from the scripting bucket before reporting**, so `scripting` means app scripting. Scenarios share one browser session in repo order; a scenario that needs a starting state sets it in its `setup` rather than inheriting whatever the previous one left. The measurement subject is the dev-server bundle, not the production `bun run build:studio` output, so absolute numbers carry dev-build overhead; relative hot spots are stable across the runs we took. Sub-scenario metrics below ~25 ms are noise (±50% across reps); the regression gate ignores absolute deltas under 25 ms for that reason.

## Baseline (tracked in `scripts/perf/baseline.json`, worst of 3 reps, Sept 19 2026)

| scenario                             | wall                | scripting (app, harness subtracted) | style recalc               | layout                 | GC       |
| ------------------------------------ | ------------------- | ----------------------------------- | -------------------------- | ---------------------- | -------- |
| boot (no document)                   | 678–1852 ms         | 134–360 ms                          | 42–147 ms (7 recalcs)      | 98–235 ms (7 layouts)  | 14–29 ms |
| document-boot (?file=pages/index.md) | 2907–4419 ms        | 362–855 ms                          | 632–1448 ms (25 recalcs)   | 55–172 ms (22 layouts) | 19–74 ms |
| assistant open/new/close ×3          | 168 ms              | 24 ms                               | 31 ms (5 recalcs)          | 3 ms                   | 0 ms     |
| palette open+filter+close ×3         | 860–1836 ms         | 144–387 ms                          | 426–942 ms (32–34 recalcs) | 9–24 ms                | 5–16 ms  |
| file palette ×3                      | 559–1242 ms         | 18–143 ms                           | 331–805 ms (23–32 recalcs) | 2–7 ms                 | 0 ms     |
| region cycle ×6                      | 239–351 ms (no doc) | 13 ms                               | 11–22 ms                   | 1–4 ms                 | 0–5 ms   |
| navigator/inspector/dock ×9          | 284–357 ms          | 7–14 ms                             | 206–559 ms                 | 10–39 ms               | 0 ms     |
| settings open+close ×3               | 331–904 ms          | 51–137 ms                           | 101–291 ms (6–14 recalcs)  | 10–25 ms               | 0 ms     |

No scenario produced a main-thread task ≥50 ms — there is no single catastrophic jank frame — but individual restyles reach 55 ms and a document boot carries 630–1450 ms of style recalculation before the canvas is live, which is the perceived "opening a page is slow" cost.

## Bottlenecks, in order of traced impact

##### 1. Document-wide style recalculation from a small trigger (facilitated by `jx` custom-element matching)

An overlay open, a filter keystroke, or a region switch invalidates a `JX-BUTTON` root node ("Style rule change" — 2108 invalidation records in one palette cycle), and every subsequent recalculation sweeps the whole document: 15–34 recalcs per scenario at 20–40 ms each. `UpdateLayoutTree` was always the answer "whole document" (`args.beginData.totalElementCount` absent on `Layout` rather than partial), so the costs accumulate across a burst.

##### 2. Eager assistant surface at boot

`packages/studio/src/surfaces/ai-chat.ts:542` — a single `FunctionCall` of 250–448 ms during `connectedCallback` on every boot, before the assistant is opened. The element boots the chat view and its island projections up front even when the panel is never opened in the session (assistant tab closed).

##### 3. Forced synchronous layout in measure helpers

Repeated reads interleaved with writes chain into the recalculation sweep above:

- `packages/studio/src/ui/virtual-window.ts:288` (`nearestScroller`) walks ancestors reading `scrollHeight`/`clientHeight` + `getComputedStyle` per node — 6–559 ms attributed per gesture when the walk lands dirty.
- `packages/studio/src/ui/virtual-window.ts:422` (`measuredRowHeight`) reads `row.offsetHeight` in render paths — 27–84 ms recalcs.
- `packages/ui/src/behaviors/split.ts:209` (`trackOf` — also re-exported as `trackOf` in `packages/studio/src/ui/panel-resize.ts:168`) walks with `getComputedStyle` + `getBoundingClientRect` per ancestor, per gesture — 457 ms worst event (region cycle).
- `packages/ui/src/behaviors/listbox.ts:110` calls `scrollIntoView({block:"nearest"})` after writing `selected` row-by-row, forcing a layout per write batch (48–105 ms per palette open) plus observing subtree attribute+childList (compounds on each filter keystroke).

##### 4. Opening a document: the measure-walk cost is the dominant recalc trigger

The new `document-boot` scenario isolates what `?file=pages/index.md` pays on top of bare boot: 632–1448 ms of style recalculation across 25 recalcs, attributed to:

- `packages/ui/src/behaviors/split.ts:209` (`trackOf`): 234 ms for 2 recalcs — the splitter measuring its track while the shell settles after the document render.
- `packages/studio/src/ui/virtual-window.ts:288` (`nearestScroller`): 160 ms — the Layers tree resolving its scroller during the initial layers render (`layers-panel.ts:417` is the traced caller).
- `packages/studio/src/studio.ts:610` (the boot open path): a single 173 ms `FunctionCall`.
- `ai-chat.ts:542` again (54 ms) even though the assistant is never opened in the session.
- `measuredRowHeight` / `topBandHeight` / `maintain` (the canvas live-render idle loops): 13–50 ms.

##### 5. Canvas-by-way-of-iframe update chatter

When a document is open, `iframe-entry`'s idle sampler (`sampleIdle`, `postContentHeight`) and `ws.onmessage` co-host ~35–65 ms per frame, and the panels scenario turned a 20 ms scripting scenario into 600–900 ms of rendering when a canvas was live — i.e., the canvas is a state amplifier for cheap shell interactions.

##### 6. Palette rows are re-constructed per query, and modal insertion invalidates the shell

The palette's option rows are key-diffed (`surfaces/palette.json` maps rows through `key`), yet a filter keystroke still re-created each `jx-option`'s icon and end slots (`childList` records per row), and the `jx-listbox` sidecar answered EVERY mutation record with a full `syncListbox` — a `querySelectorAll` walk plus a flush-baiting read per record (traced: 5–20 ms each, once per record, dozens per palette cycle). The document-wide sweep per open/close remains attributed as `(anonymous)` (no JS stack; Chrome's recalc-on-any-link/`dialog`-adjacent style invalidation) — it is the remaining unsolved per-open cost; batching `modulepreload` insertions collapses redundant sweeps but the first open per chunk still pays.

##### 7. Minor, still itemized

`syncListbox` (listbox.ts:110) per-row writes; `quick-search.ts:930` 17 ms on palette open; tabulator's `measure` (`studio` chunk line 16669) on panel switches; `canvas-render.ts:197` 49 ms; dialog `::backdrop` conditional recalcs (→ `focusShellRegion` path, 1–21 ms).

## Shipped in this change set, with the trace evidence

##### `package/studio` → `services/module-preloads.ts`

The bundler's lazy-graph runtime appends one `<link rel=modulepreload>` per chunk to `head` on the first `import()` of every graph. Insertions land on the palette's first open and each of them invalidates style matching document-wide (the DevTools timeline's `Style rule change` × N records). The batcher (`installModulePreloadBatcher`, installed on the studio entry's module scope, idempotent per `head`) queues those links and appends the whole batch on one animation frame, so redundant sweeps disappear and only the first chunk of the palette's own graph pays one sweep.

##### Verified deltas (same-day runs, same fix set, `--compare`)

- `boot`: app scripting 137 → 76 ms and boot wall 662 → 432 ms (tracing at ~23:40 after the palette fixes; the assistant's de-lazy is the same change set and `ai-chat.ts` left the boot trace's hot list).
- `document-boot`: scripting 362 → 254 → 211 ms across the three fix tiers, style 632 → 564 → 522 ms.
- `palette`: scripting 139 → 95 ms with the persistent overlay (style recalc 414 → 366 ms across 31 open/close/filter cycles).
- `palette-files`: script 21 → 11 ms, style 280 → 9 ms (−97%), wall 482 → 175 ms — the persistent-mount + hidden-toggle rebuild is where most of the per-open sweep was living.
- `settings`: style recalc 101 → 0–37 ms across the same tiers.

Each runs N repetitions (`--reps`; the MEDIAN repetition by active engine time is reported, after an experiment that showed single outliers dominating a worst-run scheme). Results land in scripts/perf/out/traces.json The rclone bisync churning in the background (~45% CPU) produced comparative runs reading +50–80% higher than the baseline across ALL scenarios every time it was live; then re-measured later after the load settled as low. Any `--compare` regression-vs-noise call has to compare within a quiet window; the 25 ms floor removes the small-metric flags but does not rescue a run taken under full machine load. The dev server also watches the entire tree and rebuilds the studio bundles on EVERY file write, so the trace artifacts go to `/tmp` by default now instead of `scripts/perf/out` (`--out` can be overridden).

**Reporting the median:** the worst-of-N scheme put a one-shot 1100 ms outlier on the palette (a warm window's other repetitions measured ~200 ms each), and the tracked baseline was then tying a claim to the noise. `bun run perf:studio` now reports the median repetition by active engine time, and the same metric powers `--compare`.

##### The remaining document-boot cost, revisited (post fixes)

With the caches in, `document-boot`'s style recalculation settles at 500–520 ms across 18 recalcs, and the two biggest events are the FIRST reads still paying the boot flush: `trackOf` 181 ms and `nearestScroller` 162 ms (a read during a dirty tree has to complete the whole pending recalculation before it can answer, so the flush lands where the read does). The repeats are gone; what remains is the price of reading through a tree the boot batch left dirty. Around the two, invalidation records in the same window stay dominated by `Style rule change` per element (178 SPAN/89 DIV/24 JX-ICON records) with an inline `JX-POPOVER` style write in the middle — the broad per-element invalidation reason remains Chrome-internal and is the next diagnostic target, not a findable app mutation in the trace.

##### The production-build baseline (tracked as `scripts/perf/baseline-production.json`

The tracked dev-server baseline hashes dev-bundle overhead, so Phase 1's trailing item was to hash the state against the RELEASE bundle (`bun run --cwd packages/studio build`, written into dist/ and served by the same dev server paths; the watcher ignores `dist/**`, so a release bundle survives a trace). `--baseline-out scripts/perf/baseline-production.json` records it and `--compare scripts/perf/baseline-production.json` gates against the release window.

The release bundle no longer carries the lit dev-mode warning and the numbers hold their shape against dev rather than shrinking with it — so the artifacts are comparable:

| scenario      | wall prod → dev | scripting | styleRecalc | layout   |
| ------------- | --------------- | --------- | ----------- | -------- |
| boot          | 640 → 432       | 118 → 76  | 30 → 16     | 3 → 1    |
| document-boot | 3744 → 2243     | 213 → 211 | 686 → 522   | 101 → 41 |
| palette       | 644 → 664       | 57 → 95   | 377 → 366   | 6 → 8    |
| palette-files | 148 → 175       | 4 → 11    | 9 → 9       | 2 → 3    |
| canvas-edit   | 1239 → 1410     | 166 → 186 | 569 → 708   | 42 → 18  |
| regions       | 272 → 224       | 9 → 7     | 11 → 15     | 4 → 3    |
| panels        | 335 → 440       | 1 → 5     | 128 → 288   | 2 → 1    |
| settings      | 116 → 144       | 3 → 2     | 0           | 0        |

The two rows that matter shape the honest rank of remaining work: production is FASTER than the dev server in interactions this quiet window, and equal or slower on `document-boot`/`canvas-edit` — and the two ARE the remaining unsolved areas (the document-wide `Style rule change` sweeps and the cold-first-read flush). The style recalculation survives the bundler, so it is not build artifact; it is app work and the plan's diagnosis stays valid.

##### One considered experiment was measured and REJECTED: deferring the first measure a frame

Deferring `createVirtualWindow`'s opening `measure()` to the next animation frame (so the boot's first read lands at a settled frame boundary instead of flushing mid-render) moves the ~150 ms forced flush rather than removing it: the boot's layout work runs on the frame's own pass either way. The change demanded eight test-semantics changes in `virtual-window.test.ts` and returned the same totals, so it was reverted; the steady-state caches (`scrollerFor`, `trackOf` identity memoization, listbox per-frame coalescing) that DID remove repeats stay.

##### The grid path is now traced (`grid-edit`)

`collection.editInGrid { name: "docs" }` on the traced site's own collection is scriptable (read-only in the scenario: the grid opens, the mode cycles to Source and back, nothing saves), so the data grid's cost profile is part of the baseline: the grid's first open carries the tabulator lazy-graph weight (its own chunk, `fitToData` per column, `adjustTableSize`) and the Outline panel pays its measure walk alongside (the `layers-panel.ts` attribution showing in the first open's hot list). The steady per-mode cycle is cheap; grid-open itself is the actor. Remaining: a scenario that writes a ROW (requires a throwaway collection fixture so the user's site is untouched).

##### Phase 1 — codify the baseline (done)

1. Done: NINE scenarios (boot, document-boot, assistant, canvas-edit, palette, palette-files, regions, panels, settings), harness-cost subtraction, median-of-N reporting, `/tmp`-default artifacts, and source-map attribution, harness-cost subtraction, tracked `scripts/perf/baseline.json` (written with `--write-baseline 1`), and `--compare scripts/perf/baseline.json` printing per-scenario deltas and exiting non-zero on a >20% plus >25 ms regression.
2. Done: the release build is baselined too (`bun run build:studio`, `scripts/perf/baseline-production.json`, `--baseline-out` + `--compare scripts/perf/baseline-production.json`) — see the production section above.
3. Remaining: a row-carrying grid scenario — the grid's add/edit path writes the collection file, which the traced site's real data cannot afford, so it needs a throwaway collection fixture (a project in /tmp with its own content dir) that `trace-studio.ts --url` can point at; `canvas-edit`'s text-edit path likewise wants a document whose save is disposable.

##### Phase 2 — targeted fixes (top 4 by measured impact)

1. **Break the write-read cycles in measure helpers** (now the single largest traced cost: ~400 ms of `document-boot`, plus scene-level findings at settings/panels): cache `nearestScroller` resolution per element until its structure actually changes (the code already re-binds per render — extend that to resolve-per-structure rather than resolve-per-read). Cache the first-row measured height per list until resize (currently re-read every `measuredRowHeight` call). For `trackOf`, resolve the track element once per `mountSplit` rather than per bounds evaluation.
2. **De-lazy the assistant boot cost.** `ai-chat.ts` boots its view during `connectedCallback` but is only visible when the assistant opens (`view.setAssistant {open}`). Defer the mount to the first `assistant` open (or an idle callback after boot), and confirm assistant commands keep working. Target: `ai-chat.ts` absent from the `boot` and `document-boot` traces. Traced headroom: 54–292 ms per boot.
3. **Scope the document-wide recalcs** (palette + panels path): audit what a `palette.open` / `focused-region` state write actually changes. Expected pattern: an attribute/class flip on an ancestor of most of the shell triggers `Invalidation set invalidates subtree` for every `jx-button`. Fix by (a) moving state into a `.palette-open` class on the overlay host (not `html`/`body`), (b) `contain: layout style` on the overlay layer and on `shell` regions so a recalc inside cannot be scheduled document-wide, and (c) when palette filtering, writing the active row id once (`data-active`) rather than N `selected` writes, which the `jx-listbox` sidecar already reads.
4. **DONE — listbox sidecar coalesced** (`packages/ui/src/behaviors/listbox.ts`): the MutationObserver path now schedules ONE `syncListbox` per animation frame (last record answers; rAF absent → synchronous fallback, so test semantics hold), cutting a `querySelectorAll` + flush per record down to one per frame. Direct `syncListbox` calls stay synchronous — the per-row `selected` write discipline was already minimal (only rows that change) and the scrollIntoView fallback is per-frame in the sidecar path.

##### Phase 3 — structural improvements

1. Boot budget: cut the document-boot path to `< 1.5s` cold (`document-boot` baseline is 2.9 s). Keep `shell.ts` + tab strip on the critical path; Monaco is already lazy — confirm its worker commit does not intrude on first idle.
2. Interaction isolation: measure again after Phase 2 and gate the remaining deltas with budgets: `boot ≤ 1.0s`, `document-boot ≤ 1.5s`, `palette style-recalc bundle ≤ 100ms per open`, `recalcs triggered per palette filter ≤ 3`, `regions ≤ 25 ms`. The budgets live in the tracked `scripts/perf/baseline.json` and run via `bun run perf:studio --compare scripts/perf/baseline.json` nightly in CI so a regression in recalculation scoping is caught before review.

##### Phase 4 — revise, don't guess

Re-run `perf:studio --scen boot,document-boot,palette --compare scripts/perf/baseline.json` after the phase-2 fixes and confirm: `trackOf`/`nearestScroller` costs drop by an order of magnitude, `ai-chat.ts` leaves the boot trace, and palette open stops generating document-wide recalcs.

## Running it today

```
bun run perf:studio --reps 3                                   # all scenarios, 3 reps each, median reported
bun run perf:studio --scen boot,document-boot                  # subset
bun run perf:studio --dump 1                                   # raw trace JSON per scenario and rep
bun run perf:studio --url <head> --base-url <base>             # the A/B gate (5 interleaved reps per side)
bun run perf:studio --reps 3 --compare scripts/perf/baseline.json  # trend vs the tracked baseline (exit 1)
bun run perf:studio --write-baseline 1 --baseline-out /tmp/b.json  # capture a baseline (adopt only from CI)
bun run perf:studio --summary out.md ...                       # append the Markdown table to a file
bun run perf:studio --cpu-throttle 3 ...                       # slow the renderer to reproduce runner timing locally
bun test scripts/perf --isolate                                # analytics and gate unit tests
```

Every command and every idle probe runs against a 30 s deadline (`withDeadline`). The first CI A/B run failed `canvas-edit` and `grid-edit` on head with `{"code":-32000,"message":"Promise was collected"}`: the inspector holds an awaited promise weakly, so a step that never settled was collected and the error named nothing. The deadline's timer holds the race strongly, so a hang is now `command "<id>" did not settle within 30000 ms`, and it is cleared as soon as the step settles. The error kept coming back on later runs within two seconds of a step starting, with no navigation and no renderer crash beside it (each side now logs both), so it is not a hang and not a reload. Every awaited step is therefore also held from a page global and records its own outcome there (`rootedStep`); when the inspector still reports the promise collected, the harness reads that record until the step settles and judges the step by it (`awaitStep`), logging that it did.

The Inspector dock hides a tab panel or leaf that is not showing with `content-visibility: hidden` and `visibility: hidden` rather than `display: none` (`src/surfaces/inspector-dock.json`). The Inspector shows its Page panel on every deselect and every close of the Assistant (studio.md §6), and a panel that left the box tree is restyled whole on its way back: 302 elements per deselect in `canvas-edit`. With its computed style kept, `assistant`'s style recalculation went from 15.8 to 7.1 ms (base 15.8) under a 2x CPU throttle, and `canvas-edit`'s total from 60 to 41.5 ms in one local trace.

Both sides enter every scenario from the same state, because every scenario gets a fresh Chrome on each side (a new profile, launched, Studio loaded, then the scenario's own setup). A shared browser could not promise that. The second CI A/B run showed why: base's `grid-edit` setup threw (its grid draws no rows), base was reloaded and skipped the scenario's repetitions while head ran all five, and `regions`, next, read wall 299 → 396 ms (+33%). Locally, after head alone ran `grid-edit`, head's `regions` paid exactly one extra 33 ms frame even with both sides reloaded, while the same scenario A/B'd on its own read 231 against 231 ms. A reload resets the page, not the renderer. `regions` also opens its own page first now, as every other scenario that needs one does. The fresh browsers cost a Studio boot per side per scenario, untraced.

`canvas-edit` and `panels` run their steps once in setup, untraced (`warmed`), so every traced repetition starts from the state the steps leave rather than from whatever each build shows first. Without it the first step paid for a starting state the two builds do not share: head's Design workspace opens the Navigator on Site and base's on Layers, so `panels`' first `view.setActivity { tab: "layers" }` drew the whole Outline on head (2,511 elements restyled, 44 ms) and nothing on base.

The dev server must be running (`bun run dev`, port from `JX_DEV_PORT`); Chrome must be on the PATH (`google-chrome-stable`) or named by `CHROME_BIN`.

## Out of scope here (noted, not profiled)

Rich canvas editing (iframe text editing, drag & drop) with a real document open, because the fixtures for the traced project run without an open document — the state-amplification finding in §Bottleneck 4 came from post-palette contamination and deserves its own follow-up with a fixture that opens a document.
