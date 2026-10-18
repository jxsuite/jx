/** Tests for src/content/file-records.ts: the records a file-backed collection's file holds. */
import { describe, expect, test } from "bun:test";
import { fileRecords, recordKey } from "../src/content/file-records";

const CSV = [
  "Title,sku,4Hrs",
  '"18\' Tilt Trailer 9,990 GVW  ",tilt-9900,70.00',
  ",,",
  "Mini Trencher,trencher,55",
  "",
].join("\n");

describe("fileRecords", () => {
  test("a CSV is one record per data row under its header, blank rows skipped", () => {
    const records = fileRecords("content/pricing/prices.csv", CSV);
    expect(records).toEqual([
      {
        fields: { "4Hrs": "70.00", Title: "18' Tilt Trailer 9,990 GVW  ", sku: "tilt-9900" },
        index: 0,
        title: "18' Tilt Trailer 9,990 GVW",
      },
      {
        fields: { "4Hrs": "55", Title: "Mini Trencher", sku: "trencher" },
        index: 1,
        title: "Mini Trencher",
      },
    ]);
  });

  test("the schema's title field names a record, else a title-like column, else its first text", () => {
    const schema = { properties: { name: { type: "string" as const } }, type: "object" as const };
    expect(fileRecords("a.csv", "sku,name\nx,Ex\n", schema)?.[0]?.title).toBe("Ex");
    expect(fileRecords("a.csv", "sku,Label\nx,Labelled\n")?.[0]?.title).toBe("Labelled");
    expect(fileRecords("a.csv", "sku,qty\n,4\n")?.[0]?.title).toBe("4");
  });

  test("a record with no text at all is called by its row number", () => {
    expect(fileRecords("a.json", "[{}]")?.[0]?.title).toBe("Row 1");
  });

  test("a JSON array is one record per object, its values as list text", () => {
    const records = fileRecords("c/items.JSON", '[{"title":"One","n":2,"tags":["a","b"]}, 3]');
    expect(records?.map((record) => record.title)).toEqual(["One", "Row 2"]);
    expect(records?.[0]?.fields.n).toBe("2");
  });

  test("JSON that is no array, JSON that does not parse, and other kinds hold no records", () => {
    expect(fileRecords("a.json", '{"title":"x"}')).toBeNull();
    expect(fileRecords("a.json", "{")).toBeNull();
    expect(fileRecords("a.yaml", "- a")).toBeNull();
  });

  test("a record is keyed by its file and its place in it", () => {
    expect(recordKey("content/p.csv", 2)).toBe("content/p.csv#3");
  });
});
