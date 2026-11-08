/**
 * The Media workspace's model — `src/media/media-library-model.ts`: what each filter keeps and may
 * claim, the three sorts, the search, the counts, and the grid's keyboard walk. Pure, so no DOM.
 */
import { describe, expect, test } from "bun:test";
import {
  MEDIA_FILTERS,
  MEDIA_FILTER_KEYS,
  MEDIA_SORT_KEYS,
  NO_ANSWERS,
  TILE_GAP,
  TILE_MIN_WIDTH,
  filterCounts,
  gridColumns,
  gridStep,
  isMediaFilterKey,
  isMediaSortKey,
  isRecordFilter,
  matchesQuery,
  mediaFilterLabel,
  passesFilter,
  tagCounts,
  tagFilterKey,
  tagOfFilter,
  visibleMedia,
} from "../src/media/media-library-model";
import type { FilterAnswers, LibraryMediaFile } from "../src/media/media-library-model";
import type { MediaRecord } from "../src/files/xmp-packet";

const FILES: LibraryMediaFile[] = [
  { bytes: 900, file: "public/hero.jpg", kind: "image", modified: "2026-01-01", name: "hero.jpg" },
  { bytes: 50, file: "public/b.png", kind: "image", modified: "2026-03-01", name: "b.png" },
  { bytes: null, file: "public/clip.mp4", kind: "video", modified: null, name: "clip.mp4" },
  {
    bytes: 10,
    file: "public/menu.pdf",
    kind: "document",
    modified: "2026-02-01",
    name: "menu.pdf",
  },
];

const paths = (files: readonly LibraryMediaFile[]) => files.map((file) => file.file);

/** Answers holding these records, not yet settled. */
function withRecords(records: Record<string, MediaRecord>): FilterAnswers {
  return { ...NO_ANSWERS, records: new Map(Object.entries(records)) };
}

describe("the filters", () => {
  test("are the eight the spec names, in its order, and no others", () => {
    expect(MEDIA_FILTERS.map((filter) => filter.label)).toEqual([
      "All media",
      "Images",
      "Video",
      "Audio",
      "Documents",
      "Fonts",
      "Missing alt text",
      "Unused",
    ]);
    expect(MEDIA_FILTER_KEYS).toEqual([
      "all",
      "image",
      "video",
      "audio",
      "document",
      "font",
      "missing-alt",
      "unused",
    ]);
  });

  test("a stored or scripted value is checked, not trusted", () => {
    expect(isMediaFilterKey("image")).toBe(true);
    expect(isMediaFilterKey("missing-alt")).toBe(true);
    expect(isMediaFilterKey("tag:Garden")).toBe(true);
    expect(isMediaFilterKey("tag:")).toBe(false);
    expect(isMediaFilterKey("missing")).toBe(false);
    expect(isMediaFilterKey(3)).toBe(false);
    expect(isMediaSortKey("size")).toBe(true);
    expect(isMediaSortKey("oldest")).toBe(false);
    expect(MEDIA_SORT_KEYS).toEqual(["newest", "name", "size"]);
  });

  test("a label for every key, and All media for anything else", () => {
    expect(mediaFilterLabel("document")).toBe("Documents");
    expect(mediaFilterLabel("tag:Garden")).toBe("Garden");
    // @ts-expect-error -- an unknown key, which a stale value could be
    expect(mediaFilterLabel("tags")).toBe("All media");
  });

  test("Unused claims nothing until the sweep has settled", () => {
    const [hero] = FILES;
    expect(passesFilter(hero!, "unused", NO_ANSWERS)).toBe(false);
    expect(
      passesFilter(hero!, "unused", { ...NO_ANSWERS, unused: new Set(["public/hero.jpg"]) }),
    ).toBe(true);
    expect(passesFilter(hero!, "all", NO_ANSWERS)).toBe(true);
    expect(passesFilter(hero!, "video", NO_ANSWERS)).toBe(false);
  });

  test("Missing alt text and a tag ask the file's record, and claim nothing unread", () => {
    const [hero, png] = FILES;
    const answers = withRecords({
      "public/b.png": { alt: "", tags: ["Garden"] },
      "public/hero.jpg": { alt: "A hero", tags: ["garden", "Spring"] },
    });
    expect(passesFilter(hero!, "missing-alt", answers)).toBe(false);
    expect(passesFilter(png!, "missing-alt", answers)).toBe(true);
    // Unread: neither missing alt text nor tagged.
    expect(passesFilter(FILES[2]!, "missing-alt", answers)).toBe(false);
    expect(passesFilter(hero!, tagFilterKey("GARDEN"), answers)).toBe(true);
    expect(passesFilter(png!, tagFilterKey("Spring"), answers)).toBe(false);
    expect(isRecordFilter("missing-alt")).toBe(true);
    expect(isRecordFilter("tag:x")).toBe(true);
    expect(isRecordFilter("unused")).toBe(false);
    expect(tagOfFilter("tag:x")).toBe("x");
    expect(tagOfFilter("image")).toBeNull();
  });
});

describe("the search", () => {
  test("matches the name, ignoring case and surrounding space", () => {
    const [hero] = FILES;
    expect(matchesQuery(hero!, "  HERO ")).toBe(true);
    expect(matchesQuery(hero!, "public/")).toBe(false);
    expect(matchesQuery(hero!, "b")).toBe(false);
    expect(matchesQuery(hero!, "")).toBe(true);
    expect(matchesQuery(hero!, "clip")).toBe(false);
  });

  test("matches the file's alt text and tags once read", () => {
    const [hero] = FILES;
    const record = { alt: "Rows of Seedlings", tags: ["Garden"] };
    expect(matchesQuery(hero!, "seedl", record)).toBe(true);
    expect(matchesQuery(hero!, "GARD", record)).toBe(true);
    expect(matchesQuery(hero!, "bees", record)).toBe(false);
  });
});

describe("visibleMedia", () => {
  const all = { answers: NO_ANSWERS, filter: "all", query: "" } as const;

  test("Newest first, a file with no time last", () => {
    expect(paths(visibleMedia(FILES, { ...all, sort: "newest" }))).toEqual([
      "public/b.png",
      "public/menu.pdf",
      "public/hero.jpg",
      "public/clip.mp4",
    ]);
  });

  test("Name, naturally ordered", () => {
    expect(paths(visibleMedia(FILES, { ...all, sort: "name" }))).toEqual([
      "public/b.png",
      "public/clip.mp4",
      "public/hero.jpg",
      "public/menu.pdf",
    ]);
  });

  test("Size, largest first, an unmeasured size last", () => {
    expect(paths(visibleMedia(FILES, { ...all, sort: "size" }))).toEqual([
      "public/hero.jpg",
      "public/b.png",
      "public/menu.pdf",
      "public/clip.mp4",
    ]);
  });

  test("ties keep one order by path, and the input is not reordered", () => {
    const twins: LibraryMediaFile[] = [
      { bytes: 1, file: "public/z.png", kind: "image", modified: null, name: "same.png" },
      { bytes: 1, file: "public/a.png", kind: "image", modified: null, name: "same.png" },
    ];
    expect(paths(visibleMedia(twins, { ...all, sort: "size" }))).toEqual([
      "public/a.png",
      "public/z.png",
    ]);
    expect(paths(twins)).toEqual(["public/z.png", "public/a.png"]);
  });

  test("a filter and a search narrow together", () => {
    expect(
      paths(
        visibleMedia(FILES, { answers: NO_ANSWERS, filter: "image", query: "her", sort: "name" }),
      ),
    ).toEqual(["public/hero.jpg"]);
  });

  test("a search reaches the records the sweep has read", () => {
    const answers = withRecords({ "public/b.png": { alt: "", tags: ["Hero shot"] } });
    expect(
      paths(visibleMedia(FILES, { answers, filter: "all", query: "hero", sort: "name" })),
    ).toEqual(["public/b.png", "public/hero.jpg"]);
  });
});

describe("filterCounts", () => {
  test("counts every kind, and leaves Unused unknown until it is known", () => {
    expect(filterCounts(FILES, NO_ANSWERS)).toEqual({
      all: 4,
      audio: 0,
      document: 1,
      font: 0,
      image: 2,
      "missing-alt": null,
      unused: null,
      video: 1,
    });
    expect(
      filterCounts(FILES, { ...NO_ANSWERS, unused: new Set(["public/clip.mp4", "elsewhere.png"]) })
        .unused,
    ).toBe(1);
  });

  test("counts Missing alt text once every record is read", () => {
    const answers = withRecords({
      "public/b.png": { alt: "", tags: [] },
      "public/hero.jpg": { alt: "Hero", tags: [] },
    });
    expect(filterCounts(FILES, answers)["missing-alt"]).toBeNull();
    expect(filterCounts(FILES, { ...answers, recordsSettled: true })["missing-alt"]).toBe(1);
  });
});

describe("tagCounts", () => {
  test("one row per tag across case, spelled as first read, in name order", () => {
    const answers = withRecords({
      "public/b.png": { alt: "", tags: ["garden", "Bees"] },
      "public/hero.jpg": { alt: "", tags: ["Garden", "spring 10", "spring 9"] },
    });
    expect(tagCounts(FILES, answers)).toEqual([
      { count: 1, tag: "Bees" },
      { count: 2, tag: "Garden" },
      { count: 1, tag: "spring 9" },
      { count: 1, tag: "spring 10" },
    ]);
  });
});

describe("the grid's keyboard", () => {
  test("columns follow the CSS auto-fill arithmetic", () => {
    expect(gridColumns(0)).toBe(1);
    expect(gridColumns(TILE_MIN_WIDTH)).toBe(1);
    expect(gridColumns(TILE_MIN_WIDTH * 2 + TILE_GAP)).toBe(2);
    expect(gridColumns(1000)).toBe(7);
  });

  test("arrows move one cell and stop at the edges", () => {
    // Seven tiles, three columns: rows [0 1 2] [3 4 5] [6].
    expect(gridStep(0, "ArrowRight", 3, 7)).toBe(1);
    expect(gridStep(1, "ArrowLeft", 3, 7)).toBe(0);
    expect(gridStep(0, "ArrowLeft", 3, 7)).toBe(0);
    expect(gridStep(1, "ArrowDown", 3, 7)).toBe(4);
    expect(gridStep(4, "ArrowDown", 3, 7)).toBe(4);
    expect(gridStep(4, "ArrowUp", 3, 7)).toBe(1);
    expect(gridStep(1, "ArrowUp", 3, 7)).toBe(1);
    expect(gridStep(6, "ArrowRight", 3, 7)).toBe(6);
  });

  test("Home and End go to the row's ends, and with Ctrl to the grid's", () => {
    expect(gridStep(4, "Home", 3, 7)).toBe(3);
    expect(gridStep(4, "End", 3, 7)).toBe(5);
    expect(gridStep(6, "End", 3, 7)).toBe(6);
    expect(gridStep(4, "Home", 3, 7, true)).toBe(0);
    expect(gridStep(1, "End", 3, 7, true)).toBe(6);
  });

  test("a key it does not handle, or an empty grid, is left to the platform", () => {
    expect(gridStep(0, "Tab", 3, 7)).toBeNull();
    expect(gridStep(0, "ArrowRight", 3, 0)).toBeNull();
    // An index past the end is read as the last tile.
    expect(gridStep(99, "ArrowLeft", 3, 7)).toBe(5);
  });
});
