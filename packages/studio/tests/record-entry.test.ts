/**
 * Tests for src/content/record-entry.ts: one CSV record of a file-backed collection, edited as an
 * entry in the form-only editor, through its file's grid buffer (studio.md §22.5).
 */
import { flush, installMockPlatform, resetStudioState, surfaceOf } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Tab } from "../src/tabs/tab";
import type { EntryFields } from "../src/content/entry-fields";

void mock.module("tabulator-tables", () => ({}));
void mock.module("tabulator-tables/dist/css/tabulator.min.css", () => ({}));
void mock.module("../src/format/format-host.js", () => ({
  formatForPath: (path: string | null) =>
    path?.endsWith(".csv") ? { extensions: [".csv"], name: "Csv" } : null,
  loadFormats: async () => {},
}));
/* The file opener is doubled: the real one reaches the format registry and the packages layer. It
   opens a `.csv` as its grid tab, which is the one thing it does for this module. */
void mock.module("../src/files/files.js", () => ({
  openFileInTab: async (path: string) => {
    const { openCsvGridTab } = await import("../src/grid/grid-open");
    await openCsvGridTab(path);
  },
}));

const { getGridController } = await import("../src/grid/grid-controller");
const { closeAllTabs } = await import("../src/workspace/workspace");
const {
  commitRecordFields,
  forgetRecord,
  hasRecord,
  isRecordTab,
  openRecordEntry,
  recordFields,
  recordOf,
  recordPlace,
  showRecord,
} = await import("../src/content/record-entry");
const { commitEntryFields, entryFields, mutateEntryField } =
  await import("../src/content/entry-fields");
const { recordCollectionOfPath } = await import("../src/content/entry-model");
const { detachEntryPane, renderEntryMode, titleFirst } =
  await import("../src/content/entry-editor");
const { clearGridReveal, pendingGridReveal } = await import("../src/grid/grid-reveal");

/** A list field's items, out of the reactive array the buffer holds them in. */
function tagsOf(fields: EntryFields): unknown[] {
  const tags = fields["Tags"];
  return Array.isArray(tags) ? [...tags] : [];
}

let platform: ReturnType<typeof installMockPlatform>;

const CSV = 'Title,Date,Tags,Price\nFirst,6/3/2026,a,1\nSecond,2026-05-01,"b, c",2\n';

beforeEach(() => {
  closeAllTabs();
  resetStudioState({
    projectConfig: {
      content: {
        projects: {
          format: "Csv",
          schema: {
            properties: {
              Date: { format: "date", type: "string" },
              Price: { type: "number" },
              Tags: { items: { type: "string" }, type: "array" },
              Title: { type: "string" },
            },
            type: "object",
          },
          source: "./content/projects.csv",
        },
      },
    },
  });
  platform = installMockPlatform({}, { "content/projects.csv": CSV });
});

describe("openRecordEntry", () => {
  test("opens the file's grid tab in the entry form, on the record asked for", async () => {
    const tab = await openRecordEntry("content/projects.csv", 1);
    expect(tab?.session.ui.canvasMode).toBe("entry");
    expect(tab?.capabilities.modes[0]).toBe("entry");
    expect(hasRecord(tab!)).toBe(true);
    expect(isRecordTab(tab!)).toBe(true);
    await flush(4);
    expect(recordOf(tab!)).not.toBeNull();
    // Typed as the grid types it; a CSV's own date spelling is shown as the day it means.
    expect(recordFields(tab!)).toEqual({
      Date: "2026-05-01",
      Price: 2,
      Tags: ["b", "c"],
      Title: "Second",
    });
    expect(entryFields(tab!)).toEqual(recordFields(tab!));
    expect(recordPlace(tab!)).toMatchObject({ index: 1, next: null, total: 2 });
  });

  test("a date the CSV spells its own way is shown as an ISO day", async () => {
    const tab = await openRecordEntry("content/projects.csv", 0);
    await flush(4);
    expect(recordFields(tab!)["Date"]).toBe("2026-06-03");
    const place = recordPlace(tab!);
    expect(place.previous).toBeNull();
    expect(place.next).not.toBeNull();
    showRecord(tab!, place.next!);
    expect(recordFields(tab!)["Title"]).toBe("Second");
  });

  test("an edit is a pending cell of the grid, undone as one step, and saved with the file", async () => {
    const tab = await openRecordEntry("content/projects.csv", 0);
    await flush(4);
    const controller = getGridController(tab!)!;
    commitEntryFields(tab!, { Price: 9, Tags: ["x", "y"], Title: "Renamed", Unknown: "ignored" });
    const edited = recordFields(tab!);
    expect([edited["Price"], edited["Title"]]).toEqual([9, "Renamed"]);
    expect(tagsOf(edited)).toEqual(["x", "y"]);
    expect(tab!.doc.dirty).toBe(true);
    expect(controller.buffer.undo()).toBe(true);
    expect(recordFields(tab!)["Title"]).toBe("First");

    mutateEntryField(tab!, "Title", "Renamed");
    commitRecordFields(tab!, { Tags: undefined });
    expect(recordFields(tab!)["Tags"]).toBeUndefined();
    commitRecordFields(tab!, { Title: { nested: true } });
    expect(recordFields(tab!)["Title"]).toBe('{"nested":true}');
    commitRecordFields(tab!, { Tags: [1, "two"] });
    expect(tagsOf(recordFields(tab!))).toEqual(["1", "two"]);
    commitRecordFields(tab!, { Price: true });
    commitRecordFields(tab!, { Title: "Renamed" });

    await controller.save();
    expect(tab!.doc.dirty).toBe(false);
    // Only the edited cells moved; the other row is the bytes it was read as.
    expect(platform.state.files.get("content/projects.csv")).toBe(
      'Title,Date,Tags,Price\nRenamed,6/3/2026,"1, two",true\nSecond,2026-05-01,"b, c",2\n',
    );
  });

  test("a record collection is the file's, even though no entry FILE can be made in it", () => {
    expect(recordCollectionOfPath("content/projects.csv")?.name).toBe("projects");
    expect(recordCollectionOfPath("elsewhere.csv")).toBeNull();
    expect(recordCollectionOfPath(null)).toBeNull();
  });

  test("with no grid or no record, a tab has no record fields and a commit does nothing", async () => {
    const tab = await openRecordEntry("content/projects.csv", 0);
    forgetRecord(tab!);
    expect(recordOf(tab!)).toBeNull();
    expect(recordFields(tab!)).toEqual({});
    commitRecordFields(tab!, { Title: "x" });
    expect(tab!.doc.dirty).toBe(false);
    expect(recordPlace(tab!).index).toBe(-1);
  });

  test("a file whose rows cannot be read names no record, so the form draws none", async () => {
    const tab = await openRecordEntry("missing.csv", 0);
    await flush(4);
    expect(recordOf(tab!)).toBeNull();
    expect(recordFields(tab!)).toEqual({});
  });
});

describe("a record's lifetime", () => {
  test("is its tab's: closing the file forgets which record it showed", async () => {
    const tab = await openRecordEntry("content/projects.csv", 1);
    // Opened again on another record, it is the same tab and one subscription.
    await openRecordEntry("content/projects.csv", 0);
    expect(hasRecord(tab!)).toBe(true);
    closeAllTabs();
    expect(hasRecord(tab!)).toBe(false);
  });
});

describe("the entry form over a record", () => {
  /** Mount the entry form for a tab into a fresh stage, settled. */
  async function mountForm(tab: Tab): Promise<HTMLElement> {
    const host = document.createElement("div");
    document.body.append(host);
    renderEntryMode(surfaceOf(host), tab);
    await flush(8);
    return host;
  }

  test("is headed by the record's title and place, and steps through the file's rows", async () => {
    const tab = await openRecordEntry("content/projects.csv", 0);
    await flush(4);
    const host = await mountForm(tab!);
    const part = (name: string) => host.querySelector<HTMLElement>(`[part="${name}"]`);
    expect(part("name")?.textContent).toBe("First");
    expect(part("place")?.textContent).toBe("1 of 2");
    expect(part("collection")?.textContent).toBe("projects");
    part("next")!.click();
    await flush(4);
    expect(part("name")?.textContent).toBe("Second");
    expect(part("place")?.textContent).toBe("2 of 2");
    // The last record has no next; the first, no previous.
    part("next")!.click();
    part("previous")!.click();
    await flush(4);
    expect(part("name")?.textContent).toBe("First");
    part("previous")!.click();
    await flush(4);
    expect(part("name")?.textContent).toBe("First");
    // Edit in grid lands the file's grid on the row the form was showing.
    part("grid")!.click();
    expect(tab!.session.ui.canvasMode).toBe("grid");
    expect(pendingGridReveal("content/projects.csv")).toBe(0);
    clearGridReveal("content/projects.csv");
    detachEntryPane("primary");
    host.remove();
  });

  test("a record with no title is headed by its row", async () => {
    platform.state.files.set("content/projects.csv", "Title,Price\n,1\n");
    const tab = await openRecordEntry("content/projects.csv", 0);
    await flush(4);
    const host = await mountForm(tab!);
    expect(host.querySelector('[part="name"]')?.textContent).toBe("Row 1");
    detachEntryPane("primary");
    host.remove();
  });

  test("an entry's form leads with its title field", () => {
    const schema = { properties: { b: { type: "string" }, title: { type: "string" } } };
    expect(Object.keys(titleFirst(schema, schema, {}).properties ?? {})).toEqual(["title", "b"]);
    const untitled = { properties: { b: { type: "string" } } };
    expect(titleFirst(untitled, untitled, {})).toBe(untitled);
  });
});
