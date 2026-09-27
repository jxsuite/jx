---
status: drafted
disposition: implement
claims:
  - ui.md#4.1
requires: []
workspaces:
  - packages/ui
  - specs
  - docs
size: S
---

# Every theme colour resolves to a ramp step, the theme test refuses any other hex, and the spinner's colour hooks are named as the element's own

## Context

`specs/ui.md` §4.1, line 102:

> **Status: Partial.** The three layers ship: the ramp and the semantic tokens in `packages/ui/project.json`, and Studio's aliases in `packages/studio/styles/tokens.json`. Two claims do not match the theme: `--jx-bg-panel`, `--jx-bg-input`, `--jx-bg-overlay` and `--jx-switch-thumb` pair a raw `#ffffff`, `--jx-accent-fg` is a bare `#ffffff`, and `--jx-handler` and `--jx-map` are `light-dark()` pairs of hexes outside the ramp (`packages/ui/tests/theme.test.ts` holds every semantic colour but `accent-fg` and `accent-solid` to a `light-dark()`, `var()` or `color-mix()` value and refuses a ramp step copied as a raw hex, but nothing refuses a hex from outside the ramp inside a `light-dark()` pair); and `--jx-spin-color` and `--jx-spin-track-color` are not theme tokens at all but `jx-spinner`'s own override hooks, declared in `components/jx-spinner.json`.

Verified against the code. Every point in the marker holds.

**The hexes.** `packages/ui/project.json`, inside `style["@layer jx-ui"]`:

- `#ffffff` is the light side of `--jx-bg-panel`, `--jx-bg-input` and `--jx-bg-overlay` (lines 72 to 74) and of `--jx-switch-thumb` (line 99). `--jx-accent-fg` is a bare `#ffffff` (line 83).
- `--jx-handler` is `light-dark(#7c3aed, #c8a2e0)` and `--jx-map` is `light-dark(#4f46b5, #8b83e6)` (lines 95 and 96).
- The only other hex outside the ramp's own declarations is `@property --jx-accent`'s `initialValue: "#3b82f6"` (line 159), which equals `--jx-blue-500`. A registration's initial value must be computationally independent, so it cannot be a `var()`.

**The tests.** `packages/ui/tests/theme.test.ts`:

- Lines 114 to 131 hold each `SEMANTIC` colour to a value starting `light-dark(`, `var(` or `color-mix(`, exempting `/(radius|focus-ring|font|accent-fg|accent-solid)/` (line 120). The `accent-fg` exemption is what lets the bare `#ffffff` pass. The `accent-solid` exemption is already dead: that token is `var(--jx-blue-600)`.
- Lines 133 to 146 refuse a hex that equals a ramp step, and only in the `SEMANTIC` names. A hex that is not a ramp step passes, and so does any token outside `SEMANTIC`, which omits `--jx-accent-8…50`.
- Lines 104 and 191 pin `:root { --jx-gray-50` as the sheet's first declaration, so a step added in front of it breaks them.
- The only per-scheme contrast gate on the kit's values is the switch test (lines 195 to 214). `packages/studio/scripts/check-styles.ts`'s `CONTRAST_PAIRS` read the hex FALLBACKS in Studio's `styles/tokens.json` (the dark values), not the kit's theme, so a change to a kit value would not be seen there. That is a reason to keep every rendered value identical.

**The spinner.** `packages/ui/components/jx-spinner.json` declares `--jx-spin-color: currentColor` and `--jx-spin-track-color: var(--jx-border)` on the element (lines 59 and 60), beside the element's own `--jx-spin-size`, `--jx-spin-track` and `--jx-spin-dur`. `packages/ui/tests/spinner.test.ts` ("the document declares its own duration, not the project's") pins that `--jx-spin-dur` "belongs to the element, because project.json is not this element's file". The theme declares no `--jx-spin-*`. The 0.1.12 changelog line ("the spinner and popover override tokens join the semantic list") does not settle it, because `--jx-popover-offset`, added in the same entry, is a theme token (`project.json:120`).

**Found in detailing.** These are text in §4.1 or pointing at it that the code contradicts, beyond what the marker names:

- §4.1 item 1 says the neutral ramp's cast is "OKLCH hue about 250, chroma about 0.006". Measured with `srgbToOklch` from `packages/ui/src/color.ts`, every grey step sits at hue 285.5 to 286.4, with chroma from 0.003 to 0.023. The chroma is 0.006 only at `--jx-gray-950`.
- §4.1 item 2's "Every colour is a `light-dark()` pair over ramp steps or a mix of another token" leaves out the single-step tokens (`--jx-fg-muted`, `--jx-accent-solid`, `--jx-switch-track`) and a reference to another semantic token (`--jx-switch-c`). The same overstatement is in §11's CSS Color 5 note ("`light-dark()` for every semantic colour"), in `docs/extending/ui-kit.md` line 73 ("Every colour token is a `light-dark()` pair") and in `packages/ui/README.md` line 6 ("every design token, on `:root`, in `light-dark()` pairs").
- `docs/extending/ui-kit.md` line 465 says to override the spinner's hooks "on the element or an ancestor". An ancestor's value never reaches the element, because the element declares both hooks itself, and its own declaration shadows the inherited one.

Every ramp hue is already luminance-ordered, and nothing gates it. Nothing outside the theme reads a ramp step. No generated schema embeds token names (`packages/ui/project.schema.json` names none), so `schema:verify` is unaffected.

## Outcome

- `ui.md` §4.1 → Implemented. Every colour token in the theme resolves to ramp steps in both schemes. The ramp gains a white end, `--jx-gray-0`, and the four violet and indigo steps the syntax colours draw. The theme test refuses a hex anywhere in the emitted sheet unless it is a ramp step.
- Nothing rendered changes: each new step carries the exact hex it replaces.
- `jx-spinner`'s two colour hooks stay on the element. They leave §4.1's semantic list, and §4.1 says what they are.
- §4.1's neutral-ramp numbers, §11's CSS Color 5 note, `docs/extending/ui-kit.md` and `packages/ui/README.md` describe the theme that ships.
- `ui.md` stays Partial, and nothing graduates.

## Decisions

- **Open:** what do the two syntax colours become? Recommendation: add only the four steps the theme draws, at their current hexes: `--jx-violet-300: #c8a2e0`, `--jx-violet-600: #7c3aed`, `--jx-indigo-400: #8b83e6` and `--jx-indigo-700: #4f46b5`. Each is numbered where its OKLCH lightness falls on the blue ramp (0.768 against blue-300's 0.773, 0.541 against blue-600's 0.546, 0.660 against blue-400's 0.678, 0.469 against blue-700's 0.488). The pairs then read `light-dark(violet-600, violet-300)` and `light-dark(indigo-700, indigo-400)`, the same shape as `--jx-tag`'s `light-dark(blue-700, blue-300)`. Nothing Studio paints changes. The alternatives cost more. Full eleven-step ramps would make nine invented, unreviewed colours per hue public tokens that nothing draws. Recolouring the syntax onto the existing ramps would change how the canvas and the code views paint `$handler` and `$map` references, which is a design change this item does not ask for. A fuller ramp can later grow around the four steps without a rename.
- **Open:** are `--jx-spin-color` and `--jx-spin-track-color` theme tokens or the element's hooks? Recommendation: the element's hooks. The code stays as it is, §4.1's list drops the two names, and the docs drop "or an ancestor". Four reasons:
  - As a theme token, `currentColor` is not a ramp colour, so it would need a carve-out from the rule this plan gates.
  - Declared on `:root`, `var(--jx-border)` would be substituted at the root. A subtree that re-themes `--jx-border` would then stop reaching the spinner's track, which it reaches today.
  - The element already owns `--jx-spin-size`, `--jx-spin-track` and `--jx-spin-dur`, and `spinner.test.ts` pins that rule for the duration.
  - The cost is that a site cannot recolour every spinner from `:root`. It sets the hooks on the element instead, as the stylebook's "Overridden colours" group does.

  If review picks theme tokens instead: move both declarations into `project.json`, delete them from `jx-spinner.json`, add `spin` to the test's non-colour pattern, and state `currentColor` as the rule's one exception in §4.1.

- **Decided:** the white end is `--jx-gray-0: #ffffff`. It is not `--jx-white`, and it is not the `white` keyword. It is the luminance top of the neutral ramp. The ramp pattern the tests already use (`-\d+$`) reads it as a step. A keyword would pass a hex check while dodging the rule the check exists for. `--jx-accent-fg` becomes `var(--jx-gray-0)`, one step, like `--jx-accent-solid`. Every cited contrast ratio stays true, because white on `--jx-blue-600` is still 5.17:1.
- **Decided:** Studio's alias layer keeps its hex fallbacks, and `packages/studio` is not edited. §4.1 item 3 describes those hexes as the pre-paint values an alias falls back to (`tokens.json`'s `$description` says why), and `check-styles.ts` measures contrast on them. The ramp-only rule binds the kit's theme, layers 1 and 2. Because no kit value changes what it renders, every Studio fallback still equals the kit's dark value.
- **Decided:** the tests are rebuilt around the emitted sheet, not the `SEMANTIC` list. A hex scan over `declarationsIn(themeCSS())` sees every block the builder emits: the root, the scheme and density blocks, the media blocks and `@property`. A list-driven scan saw only the names somebody remembered to list. The registration's `initial-value` is the one exemption, and a separate assertion pins it to `--jx-blue-500`, so it cannot drift off the ramp either. The shape test's colour loop is replaced by one that follows each token to its ramp step in both schemes, which is strictly stronger and needs no exemption regex.
- **Decided:** §4.1's neutral-ramp numbers are corrected to what ships (hue about 286, chroma under 0.025), and the ramp is not retuned to hue 250. Retuning would repaint every grey in both themes. Every contrast gate has measured the shipped ramp. A test now holds the corrected numbers, so they cannot drift silently again.
- **Decided:** §11's CSS Color 5 note is corrected in this plan. The audit record puts a standards row's correction on the plan that owns its bound section's open item, and that row binds §4, whose only open item is §4.1.
- **Decided:** no `requires`. `plan:studio-ui-guidelines/token-pipeline-prose` replaces the kit's light hexes quoted in `studio-ui-guidelines.md` §1.1 with a pointer to `project.json`. Those values render identically before and after this plan, so either can land first. `plan:ui/principles-text` edits other paragraphs of `docs/extending/ui-kit.md` and other rows of §11. At most the two conflict textually.

## Implementation

1. **`packages/ui/project.json`**, in `style["@layer jx-ui"]`:
   - Insert `"--jx-gray-0": "#ffffff"` immediately before `--jx-gray-50`.
   - After `--jx-amber-950`, insert `"--jx-violet-300": "#c8a2e0"`, `"--jx-violet-600": "#7c3aed"`, `"--jx-indigo-400": "#8b83e6"` and `"--jx-indigo-700": "#4f46b5"`, in that order.
   - Rewrite seven values:

     | Token               | Becomes                                                  |
     | ------------------- | -------------------------------------------------------- |
     | `--jx-bg-panel`     | `light-dark(var(--jx-gray-0), var(--jx-gray-925))`       |
     | `--jx-bg-input`     | `light-dark(var(--jx-gray-0), var(--jx-gray-900))`       |
     | `--jx-bg-overlay`   | `light-dark(var(--jx-gray-0), var(--jx-gray-850))`       |
     | `--jx-accent-fg`    | `var(--jx-gray-0)`                                       |
     | `--jx-handler`      | `light-dark(var(--jx-violet-600), var(--jx-violet-300))` |
     | `--jx-map`          | `light-dark(var(--jx-indigo-700), var(--jx-indigo-400))` |
     | `--jx-switch-thumb` | `light-dark(var(--jx-gray-0), var(--jx-gray-100))`       |

   - `@property --jx-accent` is unchanged.
2. **`packages/ui/tests/theme.test.ts`** (cases under Tests):
   - Add `const RAMP_HUES = ["gray", "blue", "red", "green", "amber", "violet", "indigo"]` and derive `RAMP = new RegExp(`^--jx-(${RAMP_HUES.join("|")})-(\\d+)$`)` from it. This single pattern replaces the inline one in the old ramp-copy test.
   - Add `NON_COLOUR = /^--jx-(font|text|leading|space|control-h|field-label-w|icon-size|popover-offset|radius|focus-ring|shadow|dur|ease)(-|$)/`. Shadows are §4.3 scale tokens, not §4.1 colours, which is why `shadow` is here.
   - `SEMANTIC` gains `--jx-accent-8`, `--jx-accent-10`, `--jx-accent-15`, `--jx-accent-20` and `--jx-accent-50`, so it names every §4.1 colour.
   - Import `parseHex` and `srgbToOklch` from `../src/color.ts`. Reuse `resolve()`, `luminance()` and `declarationsIn()` as they are.
3. **`packages/ui/tests/spinner.test.ts`**: extend the duration test (under Tests). Import `themeTokenNames` from `../src/theme.ts`.
4. **`packages/ui/README.md`** line 6: "Its `style` block is the theme: every design token, on `:root`, in `light-dark()` pairs." becomes "Its `style` block is the theme: every design token on `:root`, each colour built from the ramp and paired with `light-dark()` where it differs between schemes."
5. **`packages/ui/components/jx-spinner.json`**, `packages/studio` and every other workspace: no change, under the spinner recommendation.

**Integration contract.** Once this lands:

- The kit's ramp adds `--jx-gray-0` (`#ffffff`), `--jx-violet-300`, `--jx-violet-600`, `--jx-indigo-400` and `--jx-indigo-700`, and they are public tokens a site may reference.
- Every §4.1 colour token keeps its rendered value in both schemes.
- `theme.test.ts` fails on any new hex in the theme that is not a ramp step, and on any new colour token that is not in `SEMANTIC` or does not resolve to ramp steps. A plan that adds a colour to the theme adds a ramp step and a `SEMANTIC` entry.
- `--jx-spin-*` are the element's own properties, and `themeTokenNames()` returns none of them.

## Tests

`bun test --isolate --coverage` from `packages/ui`. `packages/studio` depends on the kit, so CI's derived matrix also runs its suite. It is untouched and must stay green.

**`packages/ui/tests/theme.test.ts`**:

- "is one layered sheet of tokens on :root" (line 104) and "the theme sheet is tokens and nothing else" (line 191): the expected opening becomes `:root { --jx-gray-0: #ffffff;` and `:root { --jx-gray-0:`.
- "declares every semantic token, each colour as a light-dark pair or a token reference" becomes "declares every semantic token". It keeps its name loop over the extended `SEMANTIC` and drops the colour loop and its exemption regex, which the next case replaces.
- New, "every colour token resolves to ramp steps in both schemes":
  - Derive the colour set: every top-level `--jx-*` key of `themeTokens` that matches neither `RAMP` nor `NON_COLOUR`. Assert it equals `SEMANTIC` minus the `NON_COLOUR` names, as sets, so an unlisted colour token fails by name. There are 29 today.
  - For each token and each scheme, `resolve(token, scheme)` must be one of the ramp's hexes. Otherwise it must match `/^color-mix\(in oklab, var\((--jx-[\w-]+)\) \d+%, transparent\)$/` with the captured token resolving to a ramp hex in that scheme.
- Replaces "no ramp step is reused as a raw hex outside the ramp": "the only hexes in the sheet are ramp steps, and the accent's registered fallback is one of them".
  - For every `[property, value]` in `declarationsIn(themeCSS())` whose value matches `/#[0-9a-f]{3,8}\b/i`, `property` matches `RAMP` or is `initial-value`.
  - `themeTokens["@property --jx-accent"].initialValue` equals `themeTokens["--jx-blue-500"]`.
  - Negative control: the scan finds at least 60 ramp hexes, so a sheet that parsed to nothing cannot pass.
- New, "each ramp hue steps down in luminance, and the neutral ramp is one faint cool hue":
  - For each of `RAMP_HUES`, take the steps sorted by number. There are at least two, and `luminance()` strictly decreases along them.
  - `--jx-gray-0` is `#ffffff`.
  - Every grey step whose `srgbToOklch(parseHex(v)).c` is at least 0.002 has hue within [283, 289] and chroma at most 0.025.
- Unchanged, and still green because each rendered value is identical: the switch's 3:1 pairs (`resolve()` follows `var(--jx-gray-0)` to `#ffffff`), "this module and the site builder agree about the same block", and the `--jx-switch-c` pin.

**`packages/ui/tests/spinner.test.ts`**: "the document declares its own duration, not the project's" becomes "the document declares its own duration and colour hooks, and the theme declares none of them". It adds `style["--jx-spin-color"] === "currentColor"`, `style["--jx-spin-track-color"] === "var(--jx-border)"`, and `themeTokenNames().filter((n) => n.startsWith("--jx-spin-"))` equal to `[]`.

**`packages/studio`**, read-only confirmation. `tests/kit-tokens.test.ts` and `tests/chrome-theme.test.ts` read `themeTokens`. `--jx-bg-panel` and `--jx-bg-input` stay `light-dark()` pairs, and `--jx-accent-fg` stays single-valued, so both pass unchanged. `bun run styles:check` regenerates nothing.

**Coverage.** No TypeScript source changes: `project.json` is data and the rest is tests. `packages/ui/bunfig.toml`'s per-file bar (`lines = 0.99, functions = 1.0`) and `bun scripts/check-coverage-manifest.ts packages/ui` are unaffected, so there is no ratchet. The theme test's new import of `src/color.ts` is already fully covered by `color.test.ts`.

## Specs & docs

**`specs/ui.md`**, in place:

- **§4.1 marker** (line 102) becomes: "> **Status: Implemented.** The ramp and the semantic tokens are the token block of `packages/ui/project.json`, and Studio's aliases are `packages/studio/styles/tokens.json`. `packages/ui/tests/theme.test.ts` holds the rule below: every colour token resolves to ramp steps in both schemes, no declaration in the emitted sheet names a hex unless it is a ramp step, and each hue's steps descend in luminance."
- **§4.1 item 1** (Ramp) becomes: "**Ramp** — `--jx-gray-0…975`, `--jx-blue-*`, `--jx-red-*`, `--jx-green-*`, `--jx-amber-*`, and two syntax hues, `--jx-violet-300`/`-600` and `--jx-indigo-400`/`-700`: luminance-ordered steps, theme-independent, with quarter steps at the dark end of the neutral ramp because a dark interface lives in a ten-luminance band, and a white end, `--jx-gray-0`, for the light scheme's raised surfaces, the switch thumb and text on an accent fill. The neutral ramp carries a faint cool cast (OKLCH hue about 286, chroma under 0.025 and fading toward both ends) so grey does not read brown beside the accent. The syntax hues carry only the steps the theme draws, each numbered where its lightness falls on the blue ramp, so a fuller ramp can grow around them without a rename."
- **§4.1 item 2** (Semantic):
  - Delete ", `--jx-spin-color`, `--jx-spin-track-color`" from the list.
  - Replace "Every colour is a `light-dark()` pair over ramp steps or a mix of another token; none names a hex outside the ramp." with: "Every colour resolves to ramp steps in both schemes. It is a `light-dark()` pair of steps; one step where the colour is deliberately the same in both (`--jx-fg-muted`, `--jx-accent-solid`, `--jx-accent-fg`, `--jx-switch-track`); another semantic token (`--jx-switch-c`); or a `color-mix(in oklab, …)` of one with `transparent` (`--jx-accent-8…50`, `--jx-hover-bg`). None names a hex. The only hex in the layer outside a ramp step is the `initial-value` of `--jx-accent`'s registration (§4.5), which must be computationally independent, and it is `--jx-blue-500`'s value."
  - Append after the switch-track sentence: "An element's own custom properties are not theme tokens. `jx-spinner`'s `--jx-spin-color` (`currentColor`) and `--jx-spin-track-color` (`var(--jx-border)`) are override hooks declared in `components/jx-spinner.json` beside `--jx-spin-size`, `--jx-spin-track` and `--jx-spin-dur` (§5.2). A host sets them on the element, because the element's own declaration shadows any value it would inherit."
- **§11, CSS Color 5 row, Note cell**: "`light-dark()` for every semantic colour and `color-mix(in oklab, …)` for tints." becomes "`light-dark()` for every semantic colour that differs between schemes and `color-mix(in oklab, …)` for tints, all over the ramp (§4.1)." The sentence after it stays. Run the Markdown formatter so the table re-pads.
- **Fragment:** `bun run spec:change ui.md minor -m "§4.1 every theme colour resolves to a ramp step: the neutral ramp gains a white end, the syntax colours gain violet and indigo steps, and jx-spinner's colour hooks are named as the element's own rather than theme tokens."`

**Docs.** `docs/extending/ui-kit.md` is the only page into this area (`spec: ui.md#4`). No page cites `ui.md#4.1`. Edits:

- Line 73: "Every colour token is a `light-dark()` pair, so the theme follows the operating system." becomes "Each colour token that differs between light and dark is a `light-dark()` pair, so the theme follows the operating system." After the `data-theme` sentence, add: "Every colour token is built from the kit's ramp (`--jx-gray-0` to `--jx-gray-975`, and the blue, red, green, amber, violet and indigo steps), so a ramp step you redeclare on `:root` reaches every token drawn from it."
- Line 465: "Override `--jx-spin-color` and `--jx-spin-track-color` on the element or an ancestor to change that." becomes "Set `--jx-spin-color` and `--jx-spin-track-color` in the spinner's own `style` to change that. The spinner declares both itself, so a value set on an ancestor does not reach it."
- `code:` gains `packages/ui/project.json`, so the next theme change prompts `docs:sync` to name this page.
- No em dash in either edit.
- `docs/extending/reference/standards.md` is generated from §11 and regenerates by itself.

Nothing graduates. `ui.md` keeps open items on §2, §3.1, §3.2, §3.3, §5.1, §5.2, §5.4, §5.5, §6 and §7. The pull request deletes this plan file.

## Acceptance

- `bun test --isolate --coverage` is green in `packages/ui`, and `bun scripts/check-coverage-manifest.ts packages/ui` passes. CI's `packages/studio` leg is green with no Studio diff.
- `git grep -nE '#[0-9a-fA-F]{3,8}' packages/ui/project.json` lists only ramp-step lines and the `@property` `initialValue`.
- Reverting any one of the seven rewritten values to its old hex turns the theme test red, and the failure names the token.
- Resolved through the test's own `resolve()`, every colour token's value in both schemes is byte-identical before and after. The kit stylebook and Studio look the same in both themes.
- `bun run plans:check` passes, and `bun run plans:status --spec ui` shows `ui.md#4.1` closed with no claimant.
- `bun run docs:status`, `docs:check`, `docs:links`, `docs:prose`, `docs:standards`, `docs:markdown` and `docs:spec-release` pass, and `specs/changes/` holds the one `ui.md` fragment.

## Slices

| Slice  | Scope                                                                                            | Claims    | State |
| ------ | ------------------------------------------------------------------------------------------------ | --------- | ----- |
| TRO1.1 | The ramp steps and value rewrites, the theme and spinner tests, the §4.1 and §11 edits, the docs | ui.md#4.1 | open  |
