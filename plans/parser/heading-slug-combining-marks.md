---
status: drafted
disposition: implement
claims:
  - parser.md#3
requires: []
workspaces:
  - extensions/parser
size: S
---

# A heading's anchor keeps the combining marks its script is written with, and still drops the ones that only choose a glyph

## Context

`specs/parser.md` §3, line 43:

> **Status: Partial.** The class and every capability ship, and `$wordCount`/`$readingTime` segment words with `Intl.Segmenter` (`extensions/parser/src/md.ts`). Heading anchors are still wrong for scripts written with combining marks: `slugifyHeading` (`extensions/parser/src/transpile.ts`) keeps only letters, numbers, `_`, whitespace and `-`, so the Unicode mark category (`\p{M}`) is stripped as if it were punctuation. Devanagari, Bengali, Tamil and Thai vowel signs and viramas, and Arabic or Hebrew points, disappear from the slug, which then spells a different word than the heading: `नमस्ते दुनिया` slugifies to `नमसत-दनय`. The anchors stay unique and still agree with `$toc`.

Before the census the marker said both derived values were correct only for Latin script; 0.2.9 closed the word-count half and the NFC and letter/number halves of the slug. parser.md §3.2 promises "punctuation stripped", and a vowel sign is part of the letter it sits on, not punctuation.

**What exists** (verified 2026-09-27 with `bun` 1.3.11 against the working tree)

- `slugifyHeading(text)` in `extensions/parser/src/transpile.ts`: `normalize("NFC")`, `toLowerCase()`, `replaceAll(/[^\p{L}\p{N}_\s-]/gu, "")`, then whitespace to `-`, runs of `-` collapsed, ends trimmed. Its doc comment records why `_` stays (byte-identity with the old `\w` class on ASCII); the NFC paragraph was mangled by a formatter reflow into a stray list item (`e` / `- U+0301;`). `assignHeadingIds` calls it (`|| "section"` fallback, `-2`/`-3` dedupe) and is the one walk behind both the rendered `id`s and `$toc` (`processMarkdown` in `extensions/parser/src/md.ts`).
- Other callers import it rather than restate it: `scripts/docs/lib/headings.ts` (the anchors `bun run docs:links` checks, and the deep links `scripts/check-extension-catalog.ts` writes). `extensions/search/src/shared.ts` reads the assigned `node.id` as a section's `anchor`. Nothing in `packages/studio` reads `$toc` or slugs a heading (the stub named it; that was wrong).
- Measured today: `नमस्ते दुनिया` → `नमसत-दनय`, `সালাম বিশ্ব` → `সলম-বশব`, `வணக்கம் உலகம்` → `வணககம-உலகம`, `สวัสดีชาวโลก` → `สวสดชาวโลก`, `مَرْحَبًا` → `مرحبا`, `שָׁלוֹם עוֹלָם` → `שלום-עולם`, `क़लम` (the nukta has no precomposed form under NFC) → `कलम`, which is a different word. `한국어 제목` → `한국어-제목` is unaffected (precomposed syllables).
- **The fix the marker implies regresses emoji headings.** Adding `\p{M}` to the kept class keeps U+FE0F (VARIATION SELECTOR-16, category Mn) after the emoji it modifies is stripped, and U+20E3 (COMBINING ENCLOSING KEYCAP, Me): `❤️ Love` goes from `love` to U+FE0F + `-love`, `1️⃣ Install` from `1-install` to `1` U+FE0F U+20E3 `-install`, `#️⃣ hash` from `hash` to U+FE0F U+20E3 `-hash`. It also re-attaches a mark to the wrong letter once the punctuation between them is gone (`a!` + U+0301 + `b` → `áb`). Each is an invisible or wrong character in a URL where today's output is clean.
- **It also moves every Turkish and Azerbaijani anchor with a capital `İ`.** `toLowerCase` maps U+0130 to `i` + U+0307 (SpecialCasing.txt), so keeping marks turns `İstanbul` from `istanbul` into `i` U+0307 `stanbul`, a mark the author never wrote. A scan of every code point shows U+0130 is the only character whose NFC-then-`toLowerCase` form gains a mark it did not have after NFC; the other hits are NFC composition exclusions (`क़` U+0958, the Hebrew presentation forms), which decompose to a letter plus a mark and are meant to keep it.
- Tests: `extensions/parser/tests/transpile.test.ts`, `describe("slugifyHeading")` (punctuation, the NFC pair, the non-Latin case, the pure-ASCII corpus against the legacy `\w` function); `extensions/parser/tests/md-units.test.ts`, `describe("processMarkdown heading ids")` (ids agree with `$toc`, dedupe, `section` fallback).
- Blast radius in this repository: of 4,402 headings in tracked `*.md` files, none contains a combining mark, and the design below changes none of their slugs (measured by running both functions over every heading line). No committed anchor, docs link or search fixture moves.

**Found while detailing, not claimed.** `wordScanner()` in `extensions/search/src/client.ts` (`/[\p{L}\p{N}_]+/gu`) splits `नमस्ते दुनिया` into `नमस`, `त`, `द`, `न`, `य`, so the highlighter's `matchSpans` cannot mark a Devanagari or Thai query inside a title or excerpt. That is the search client's contract (extensions.md §8.4, site-architecture.md §12, neither of which marks it), not a heading anchor; it belongs in that spec's audit, not here.

## Outcome

- parser.md §3 → Implemented: a heading's slug keeps every nonspacing and spacing combining mark written on a kept letter or number, except a variation selector, and drops variation selectors, enclosing marks, and any mark whose base was dropped. Every heading whose NFC form has no such mark slugs exactly as today, the pure-ASCII corpus and headings with a capital `İ` included.
- parser.md graduates only if this lands last: §7, §9.1 and §9.3 are owned by `plan:_shared/collection-directive-elements`, `plan:parser/localized-mount-name-warning` and `plan:parser/uniform-entry-dates`.

## Decisions

- **Decided:** a mark is kept only as part of a kept letter or number: the character class gains `\p{M}`, a dropped character takes the marks written on it along, and a mark with no letter, number or mark before it is dropped, because otherwise a heading's slug gains an invisible leading character (`❤️ Love`) or a mark lands on a letter it was never written on (`a!` + U+0301 + `b` → `áb`). With it and the `İ` fold below, the only headings whose slug changes are those whose NFC form has a nonspacing or spacing mark on a kept letter or number.
- **Decided:** variation selectors (`\p{Variation_Selector}`, which includes the ideographic and Mongolian ones) and enclosing marks (`\p{Me}`) are removed first, because they choose how a character is drawn rather than which word it spells; keeping them would turn `1️⃣ Install` into `1` + two invisible characters + `-install`. Both are ECMAScript property escapes under the existing `u` flag, so no `v` flag and no hand-written ranges.
- **Decided:** U+0130 is folded to `i` between NFC and `toLowerCase`, because it is the one character whose default lowercase mapping adds a mark (U+0307), so without the fold every `İ` heading's anchor moves to a spelling with an invisible dot the author never typed. `i` is what the Turkish lowercase gives too, and the fold is the same for every project, so the `toLowerCase`-never-`toLocaleLowerCase` rule stands: `I` still lowercases to `i`, never `ı`.
- **Decided:** format controls (`\p{Cf}`, including ZWJ and ZWNJ) stay stripped, as today, because they are invisible in a URL and outside this item. A Persian heading written with ZWNJ keeps losing it; nothing in parser.md promises otherwise.
- **Decided:** no second implementation. `scripts/docs/lib/headings.ts`, `scripts/check-extension-catalog.ts` and the search index already take the parser's output, so the fix reaches them by construction.
- **Open:** does a link written against today's anchor for an affected heading keep working? Recommendation: no alias. Say it in the fragment and in both docs pages instead, because today's anchor is the one the spec records as wrong, an element carries one `id`, and an alias would need an extra empty anchor element in `$children` that `$toc`, the search index and markdown roundtrip serialization (§5) would each have to learn to skip. Nothing in this repository moves (0 of 4,402 headings), and the specs are pre-1.0.

## Implementation

**`extensions/parser/src/transpile.ts`, `slugifyHeading`**, the only code change. The chain becomes:

```ts
return text
  .normalize("NFC")
  .replaceAll("\u0130", "i")
  .toLowerCase()
  .replaceAll(/[\p{Variation_Selector}\p{Me}]/gu, "")
  .replaceAll(/[^\p{L}\p{N}\p{M}_\s-]\p{M}*|(?<![\p{L}\p{N}\p{M}])\p{M}+/gu, "")
  .replaceAll(/\s+/gu, "-")
  .replaceAll(/-+/g, "-")
  .replaceAll(/^-|-$/g, "");
```

The two alternatives of the second pattern must stay in one pass: stripping punctuation first and orphaned marks second would let `a!` + U+0301 re-attach the accent to `a`. Rewrite the doc comment: repair the NFC paragraph (`e` + U+0301 on one line), add a **Combining marks are part of the letter** paragraph (a Devanagari vowel sign or virama, a Thai vowel, an Arabic or Hebrew point; NFC folds the marks that have a precomposed form, and the rest stay), a **Presentation is not spelling** paragraph (the emoji examples above), and one sentence in the `toLowerCase` paragraph on the `İ` fold (the only default case mapping that adds a mark). Keep the `_` paragraph and cite parser.md §3.2, not a plan. No signature change; `assignHeadingIds` is untouched.

**Integration contract.** `slugifyHeading(text: string): string` keeps its signature and its guarantees: NFC before `toLowerCase`, ASCII output byte-identical to the `\w` implementation, `""` only when no letter or number survives (so `assignHeadingIds` still falls back to `section`). Added: a combining mark written on a kept letter or number is in the slug; variation selectors, enclosing marks, format controls, orphaned marks and the U+0307 that casing would add to `İ` never are. Any tool that needs a site's anchor imports this function; none restates it.

## Tests

`bun test --isolate --coverage` from `extensions/parser`.

- **`extensions/parser/tests/transpile.test.ts`**, `describe("slugifyHeading")`:
  - `a heading keeps the combining marks its script is written with`: `नमस्ते दुनिया` → `नमस्ते-दुनिया`, `สวัสดีชาวโลก` → `สวัสดีชาวโลก`, `வணக்கம் உலகம்` → `வணக்கம்-உலகம்`, `مَرْحَبًا` → `مَرْحَبًا`, `שָׁלוֹם עוֹלָם` → `שָׁלוֹם-עוֹלָם`, and `क़लम` keeps its nukta (assert the code points `0915 093C 0932 092E`, since NFC does not compose it and the two spellings render alike).
  - `a mark with no precomposed form survives after NFC`: `q` + U+0303 + ` tilde` → `q` U+0303 `-tilde`; `Cafe` + U+0301 still equals the precomposed spelling (the existing NFC test stays as is).
  - `presentation marks never reach the slug`: `❤️ Love` → `love`, `✔️ Done` → `done`, `1️⃣ Install` → `1-install`, `#️⃣ hash` → `hash`, `葛` + U+E0100 + `城` → `葛城`, `a` + U+20DD + ` enclosed` → `a-enclosed`. These are today's outputs; the test is what stops the naive `\p{M}` class.
  - `a mark goes with the character it was written on`: `a!` + U+0301 + `b` → `ab`; ` ` + U+0301 + `lead` → `lead`; a mark-only heading (U+0301 alone) → `""`.
  - `casing never adds a mark`: `İstanbul` → `istanbul`, `İletişim` → `iletişim` (today's outputs; the naive class gives `i` U+0307 …).
  - `every ASCII pair is byte-identical to the old implementation`: for every pair of ASCII characters `a`, `b` (U+0000 to U+007F), `slugifyHeading("x" + a + b + "y")` equals `legacy` (16,384 strings), which proves byte-identity for the whole range rather than fourteen samples. `legacy` is a `const` inside the existing corpus test today, so hoist it to the `describe` scope and let both tests use it. The existing non-Latin case and the corpus test otherwise stay unchanged.
- **`extensions/parser/tests/md-units.test.ts`**, `describe("processMarkdown heading ids")`: `anchors in a script with combining marks agree with $toc and dedupe`: `## नमस्ते दुनिया\n\n## नमस्ते दुनिया` gives ids `नमस्ते-दुनिया`, `नमस्ते-दुनिया-2`, and `$toc` ids equal them.
- Must stay green unchanged: `scripts/docs/check-doc-links.test.ts` (run by `bun test --isolate scripts`).

Coverage: `extensions/parser/bunfig.toml` gates every file at lines 0.987, functions 0.975. No function or branch is added (the change is inside one regex chain), no source file is added, so the manifest check is unaffected and no ratchet is due.

## Specs & docs

**parser.md**, in place:

- §3, line 43: the Partial marker is replaced by

  ```markdown
  > **Status: Implemented.** Heading anchors keep the combining marks of any script (`slugifyHeading` in `extensions/parser/src/transpile.ts`), and `$wordCount`/`$readingTime` segment words with `Intl.Segmenter` (`extensions/parser/src/md.ts`).
  ```

- §3.2, line 97: the parenthetical "(`slugifyHeading` in `transpile.ts`: lowercase, punctuation stripped, spaces → hyphens)" becomes "(`slugifyHeading` in `transpile.ts`: NFC-normalized, lowercased, punctuation and symbols stripped, whitespace → hyphens)", and a sentence follows it: "Letters and numbers of any script are kept together with the combining marks written on them, since a vowel sign, virama or point is part of its letter; variation selectors and enclosing marks, which choose how a character is drawn rather than what it spells, are dropped, as is a mark whose letter was. `İ` becomes `i` before lowercasing, because its default lowercase form adds a combining dot the author never wrote."
- §10, the UAX #15 row (line 232): the note gains "NFC folds the marks that have a precomposed form into their letter; a mark that has none, such as a Devanagari vowel sign or a Hebrew point, stays in the anchor as part of it." Evidence unchanged. Re-pad the table with `bun run format`.
- Fragment: `bun run spec:change parser.md minor -m "§3: heading anchors keep the combining marks written on their letters (vowel signs, viramas, points) and drop variation selectors and enclosing marks, so a Hindi, Thai, Arabic or Hebrew heading's anchor spells its heading; an existing link to such a heading's old anchor stops resolving."` (drop the last clause if the Open decision adds an alias).

**Docs** (no em dashes):

- `docs/framework/site/jx-markdown.md`, "Heading anchors" (line 145): "letters in any script are kept, so a Japanese or Cyrillic heading gets a real anchor rather than an empty one," becomes "letters in any script are kept, along with the vowel signs and points written on them, so a Japanese, Cyrillic, Hindi or pointed Hebrew heading gets an anchor that spells it rather than an empty or misspelled one," and the paragraph gains: "Anchors of Hindi, Thai, Arabic or Hebrew headings written with such marks changed when the marks started being kept, so update any link written against the older spelling."
- `docs/framework/site/content-collections.md` (line 142): after "**Letters outside ASCII are kept**, so a Japanese or Russian heading gets an anchor made of its own words rather than an empty one falling back to `section`." insert "The marks written on a letter are kept with it, so Hindi vowel signs and Hebrew points stay in the anchor (a link written before they were kept needs the new spelling), while an emoji and its variation selector are dropped."
- `docs:sync` names these two (`jx-markdown.md` lists `transpile.ts` in `code:`, `content-collections.md` cites `parser.md#3.2`); no other page cites `parser.md#3` or `#3.2`, and the standards and implementation-status pages are generated.

If §7, §9.1 and §9.3 have already closed when this lands, it also graduates parser.md: header `**Status:** Implemented`, `bun run spec:bump parser.md minor` in place with the fragment's sentence as its `-m` instead of the fragment, and delete `plans/parser/`.

On landing, delete this file and update `plans/parser/README.md`: the §3.1–§3.2 line under Verified drops "apart from the combining-mark loss §3's marker records" and the §3 paragraph under "Dispositioned without a plan" is left as history.

## Acceptance

- `bun test --isolate --coverage` passes in `extensions/parser` with no file under its threshold.
- `bun -e 'import { slugifyHeading as s } from "./extensions/parser/src/transpile.ts"; console.log(s("नमस्ते दुनिया"), JSON.stringify(s("❤️ Love")), s("1️⃣ Install"), JSON.stringify(s("İstanbul")))'` prints `नमस्ते-दुनिया "love" 1-install "istanbul"`.
- `bun run docs:links` is green with no anchor added or lost (the repository's headings carry no combining mark).
- `bun run docs:status`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:spec-release` and `bun run plans:check` are green; `bun run plans:status --spec parser` no longer lists `parser.md#3`.
