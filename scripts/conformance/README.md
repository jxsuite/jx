# The conformance harness

The compiler is being rewritten a stage at a time, and its output is allowed to change in every byte: a different module shape, different class names, different file names. So "does the new compiler do what the old one did" cannot be answered by comparing files. This harness answers it by comparing what a browser does with them.

It builds real projects, opens their pages in Chromium, records what it finds, and compares two such recordings. Two compilers conform when the recordings agree.

```sh
bun run conformance capture <dir> [--tree <repo root>] [--only a,b] [--max-routes N]
bun run conformance compare <baseline> <candidate> [--pixel-tolerance R] [--channel-tolerance N] [--json]
bun run conformance self [--only a,b] [--max-routes N]
```

It needs a Chromium (`CHROMIUM_BIN`, or one on `PATH`; the dev shell has one) and a built compiler addon (`bun run build:addon`).

## What is built

The corpus is every project in the tree: each starter under `packages/starters/sites`, each site under `sites`, and `examples`. It is derived, never listed (`corpus.ts`), so a new starter is covered by the next capture without an edit here.

Each project is built in place, by the compiler of the tree it belongs to, and served from its `dist/` as the root of an origin. It is built in place because a project may read files beside itself (the site's content is `../../docs`). When the capture of a project is done, any `dist/` or `.cache/` the build created is removed, so a starter, which is a template that gets copied and published, is never left holding a build; output that was already there is left alone. `--tree` points at another checkout, and then that checkout's projects are built by that checkout's compiler while the harness itself runs from this one. That is how a baseline from before a change is captured: the harness does not have to exist at the baseline.

`--max-routes` (default 12) caps the pages visited per project, spread evenly over the sorted routes. A site with a hundred pages from one template is mostly one page a hundred times. Pass `0` to visit them all.

A project that does not build cleanly is still captured. Its errors are recorded, with the tree's own path removed, and compared like anything else, and the pages it did write are observed.

## What is recorded

One record per route per viewport (390 px and 1280 px wide), plus a full-page screenshot beside it:

| Field           | What it is                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dom`           | The document after it has loaded, one line per element or text node: tag, sorted attributes, position and size in whole pixels, and the computed style it changes |
| `accessibility` | The accessibility tree: role, name, and state                                                                                                                     |
| `complaints`    | Console errors and warnings, uncaught exceptions, failed requests and error responses, and every request to another origin                                        |
| `interactions`  | At 1280 px: up to six controls are clicked in turn, and a digest of the DOM is taken after each                                                                   |
| `screenshot`    | The SHA-256 of the full-page PNG                                                                                                                                  |

Scripts, style sheets and module preloads are left out of `dom`. They are the compiler's plumbing, and what they do is observed in the geometry, the style, the pictures and the interactions.

## What makes a capture repeatable

A recording is only worth comparing if recording the same build twice gives the same thing. Each of these was a difference between two captures of one build before it was fixed:

- **Nothing leaves the machine.** A request to another origin is recorded and refused. The starters load web fonts from a CDN, and how fast a font arrived moved text by a pixel from one run to the next.
- **The clock and the random sequence are pinned**, before any page script runs. A page that shuffles a list shuffles it the same way every time.
- **The page is brought to rest.** It is scrolled end to end so lazy images start, the network is given time to go quiet, images are decoded, fonts are waited for until none is loading, and it is returned to the top with time for scroll-driven effects to finish. Motion is switched off.
- **One page at a time.** With six in flight the text records still agreed and a few dozen pixels along glyph and box edges did not, on different pages each run.
- **A fresh browser context per page**, so nothing is cached or stored from the page before.
- **The browser's own `/favicon.ico` probe is ignored.** Whether it lands inside the observation is a race.

`bun run conformance self` is the check on all of this: it captures this tree twice and compares exactly. It must report agreement before any comparison between two compilers means anything.

## What is tolerated

Comparison rewrites both sides with the rules in `normalize.ts` and then compares exactly. Each rule states one difference that is not a difference in behaviour, and says why:

- the port a capture was served on;
- the hash in an optimized image's file name, and a `?v=` content hash;
- a `jx-N` class the compiler mints to carry an element's own style;
- the ordinal in an island's tag name.

That list is the harness's whole tolerance. As the compiler's output is redesigned, rules are added here, in the pull request that changes the output, each with its reason. A rule added only to make a comparison pass hides the next real regression of the same shape.

Pictures are compared exactly unless told otherwise. Two encoders never write the same pixels for an image, so a comparison across an encoder change passes `--channel-tolerance` (how far a colour channel may move, 0 to 255) and `--pixel-tolerance` (the share of pixels that may still differ, 0 to 1).

## Reading a result

`compare` prints one line per finding, with the first differing lines for the text fields, and exits 1 when there is any:

```text
conformance: 2 finding(s): 1 dom, 1 pixels.

blog index.wide [dom] 1 line(s) differ, the first at line 207
    - p class="footer" @24,3976,302,18
    + p class="footer" @24,3976,303,18
blog index.wide [pixels] 0.027% of pixels differ (tolerance 0.000%)
```

A finding is a statement that the two builds behave differently. It is either a regression to fix or an intended change, and an intended change is recorded where it belongs: in the spec, and in a `normalize.ts` rule if it is a difference with no behaviour behind it.

## A baseline from another commit

```sh
git worktree add .cache/conformance/base <ref>
(cd .cache/conformance/base && bun install && bun run build)
bun run conformance capture .cache/conformance/baseline --tree .cache/conformance/base
bun run conformance capture .cache/conformance/candidate
bun run conformance compare .cache/conformance/baseline .cache/conformance/candidate
```

When a stage of the rewrite deletes the TypeScript it replaces, the last capture taken with that TypeScript is the baseline for everything after it.
