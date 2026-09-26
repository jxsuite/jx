---
status: stub
disposition: implement
claims:
  - parser.md#3
size: S
workspaces:
  - extensions/parser
---

# A heading's anchor keeps the combining marks its script is written with

## Context

`specs/parser.md` §3, line 43:

> **Status: Partial.** The class and every capability ship, and `$wordCount`/`$readingTime` segment words with `Intl.Segmenter` (`extensions/parser/src/md.ts`). Heading anchors are still wrong for scripts written with combining marks: `slugifyHeading` (`extensions/parser/src/transpile.ts`) keeps only letters, numbers, `_`, whitespace and `-`, so the Unicode mark category (`\p{M}`) is stripped as if it were punctuation. Devanagari, Bengali, Tamil and Thai vowel signs and viramas, and Arabic or Hebrew points, disappear from the slug, which then spells a different word than the heading: `नमस्ते दुनिया` slugifies to `नमसत-दनय`. The anchors stay unique and still agree with `$toc`.

Before the census the marker said both derived values were correct only for Latin script. 0.2.9 closed the word-count half and most of the slug half (NFC, and a Unicode letter/number class in place of `\w`); this is what is left. Disposition `implement`: §3.2 promises "punctuation stripped", and a combining mark is part of the letter it attaches to, not punctuation.

**What exists**

- `slugifyHeading` in `extensions/parser/src/transpile.ts`: `normalize("NFC")`, `toLowerCase()`, then `replaceAll(/[^\p{L}\p{N}_\s-]/gu, "")`. Its comment records why `_` stays in the class: every pure-ASCII heading slugifies byte-identically to the old `\w` implementation.
- `extensions/parser/tests/transpile.test.ts`: the NFC case (`Cafe` + U+0301 and `Café` agree), the non-Latin case (Japanese, Cyrillic, unvowelled Arabic), and the pure-ASCII byte-identity corpus.
- Measured at b900b326 with `bun -e`: `नमस्ते दुनिया` → `नमसत-दनय`, `สวัสดีชาวโลก` → `สวสดชาวโลก`, `مَرْحَبًا` → `مرحبا`; `한국어 제목` → `한국어-제목` (Hangul syllables are precomposed letters, so they are unaffected).
- The word-count half is closed: `processMarkdown` segments a Thai or Hindi sentence into its words rather than counting it as one (`extensions/parser/src/md.ts`, pinned by `extensions/parser/tests/md-units.test.ts`).

**What is missing**

- `\p{M}` in the kept class, so a vowel sign, virama or point survives with the letter it modifies.
- Test cases for Devanagari and Thai (and a pointed Arabic or Hebrew heading), beside the existing non-Latin case.
- The ASCII byte-identity corpus kept green, which it should be by construction: no ASCII character is in `\p{M}`.
- A decision on how to announce the change: every affected heading's anchor moves, so a link written against today's misspelled anchor breaks, and the fragment or the docs should say so.

**Related**

- parser.md §3.2 (heading anchors), parser.md §10 (the UAX #15 and UAX #29 rows).
- `packages/studio` and site search consume the same `id`s through `$toc`.
